import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { createCaptureClient } from "../plugin/job-form-voice-bridge/mcp/capture.mjs";
import { CodexDictationHistory } from "./codex-dictation-history.ts";
import type { ChannelAnswer, SanitizedPrompt } from "./domain.ts";

const execFile = promisify(execFileCallback);

export interface InterventionChannel {
  ask(
    prompt: SanitizedPrompt,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<ChannelAnswer>;
}

export interface VoiceChannelOptions {
  baseUrl?: string;
  listenSeconds?: number;
  launcherScript?: string;
}

export class VoiceInterventionAdapter implements InterventionChannel {
  readonly #baseUrl: string;
  readonly #listenSeconds: number;
  readonly #launcherScript?: string;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(options: VoiceChannelOptions = {}) {
    this.#baseUrl = options.baseUrl ?? "http://127.0.0.1:8766";
    this.#listenSeconds = options.listenSeconds ?? 15;
    this.#launcherScript =
      options.launcherScript ?? process.env.VOICE_BRIDGE_SCRIPT;
  }

  ask(prompt: SanitizedPrompt, timeoutMs = 110_000): Promise<ChannelAnswer> {
    const run = this.#tail.then(() => this.#askNow(prompt, timeoutMs));
    this.#tail = run.catch(() => undefined);
    return run;
  }

  async #askNow(
    prompt: SanitizedPrompt,
    timeoutMs: number,
  ): Promise<ChannelAnswer> {
    const startedAt = Date.now();
    if (!(await this.#isHealthy()) && this.#launcherScript) {
      return this.#askViaLauncher(prompt, timeoutMs, startedAt);
    }
    try {
      const response = await fetch(`${this.#baseUrl}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: prompt.spoken,
          timeout_seconds: this.#listenSeconds,
          tts: true,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        text?: string;
        error?: string | null;
      };
      if (!response.ok || !body.ok || !body.text?.trim()) {
        return {
          ok: false,
          channel: "voice",
          text: "",
          error: body.error ?? `Voice service returned HTTP ${response.status}`,
          elapsedMs: Date.now() - startedAt,
        };
      }
      return {
        ok: true,
        channel: "voice",
        text: body.text.trim(),
        elapsedMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        ok: false,
        channel: "voice",
        text: "",
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  async #isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.#baseUrl}/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { ready?: boolean };
      return body.ready === true;
    } catch {
      return false;
    }
  }

  async #askViaLauncher(
    prompt: SanitizedPrompt,
    timeoutMs: number,
    startedAt: number,
  ): Promise<ChannelAnswer> {
    try {
      const { stdout } = await execFile(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          this.#launcherScript!,
          "-Prompt",
          prompt.spoken,
          "-ListenSeconds",
          String(this.#listenSeconds),
        ],
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 1_000_000 },
      );
      const lines = stdout.trim().split(/\r?\n/).reverse();
      let payload:
        { ok?: boolean; text?: string; error?: string | null } | undefined;
      for (const line of lines) {
        try {
          payload = JSON.parse(line);
          break;
        } catch {
          // Ignore non-JSON PowerShell diagnostics and keep looking.
        }
      }
      if (!payload?.ok || !payload.text?.trim()) {
        return {
          ok: false,
          channel: "voice",
          text: "",
          error:
            payload?.error ?? "Voice launcher returned no usable JSON result",
          elapsedMs: Date.now() - startedAt,
        };
      }
      return {
        ok: true,
        channel: "voice",
        text: payload.text.trim(),
        elapsedMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        ok: false,
        channel: "voice",
        text: "",
        error: error instanceof Error ? error.message : String(error),
        elapsedMs: Date.now() - startedAt,
      };
    }
  }
}

export interface CodexDictationChannelOptions {
  launcherScript?: string;
  powershellBinary?: string;
  hotkey?: string;
  timeoutMs?: number;
  autoStopSeconds?: number;
  history?: CodexDictationHistory;
}

export class CodexDictationInterventionAdapter implements InterventionChannel {
  readonly #capture: ReturnType<typeof createCaptureClient>;
  readonly #options: CodexDictationChannelOptions;
  constructor(options: CodexDictationChannelOptions = {}) {
    this.#options = options;
    this.#capture = createCaptureClient({
      launcherScript: options.launcherScript,
      powershellBinary: options.powershellBinary,
    });
  }
  async ask(
    prompt: SanitizedPrompt,
    timeoutMs = this.#options.timeoutMs ?? 120_000,
    signal?: AbortSignal,
  ): Promise<ChannelAnswer> {
    const result = await this.#capture(
      {
        prompt: prompt.spoken,
        taskTitle: prompt.taskTitle,
        options: prompt.choices,
        timeoutMs,
        hotkey: this.#options.hotkey,
        autoStopSeconds: this.#options.autoStopSeconds,
        historyRoot: this.#options.history?.historyRoot,
        legacyHistoryFile: this.#options.history?.legacyHistoryFile,
      },
      signal,
    );
    return {
      ok: result.ok,
      channel: result.source === "typed" ? "terminal" : "voice",
      text: result.text ?? "",
      error: result.error,
      errorCode: result.code,
      elapsedMs: result.totalElapsedMs ?? undefined,
      captureMayBeActive: result.captureMayBeActive,
    };
  }
}

export class TerminalFallbackChannel implements InterventionChannel {
  readonly #input: Readable;
  readonly #output: Writable;
  #tail: Promise<unknown> = Promise.resolve();
  constructor(
    input: Readable = process.stdin,
    output: Writable = process.stdout,
  ) {
    this.#input = input;
    this.#output = output;
  }
  ask(
    prompt: SanitizedPrompt,
    timeoutMs = 120_000,
    signal?: AbortSignal,
  ): Promise<ChannelAnswer> {
    const deadline = AbortSignal.timeout(Math.max(1, timeoutMs));
    const active = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const run = this.#tail.then(() => this.#askNow(prompt, active));
    this.#tail = run.catch(() => {});
    return run;
  }
  async #askNow(
    prompt: SanitizedPrompt,
    signal: AbortSignal,
  ): Promise<ChannelAnswer> {
    const startedAt = Date.now();
    if (signal.aborted)
      return {
        ok: false,
        channel: "terminal",
        text: "",
        errorCode: "cancelled",
      };
    if (!(this.#input as Readable & { isTTY?: boolean }).isTTY) {
      return {
        ok: false,
        channel: "terminal",
        text: "",
        error: "No interactive terminal is available. Use the response window.",
        errorCode: "unavailable",
      };
    }
    const terminal = createInterface({
      input: this.#input,
      output: this.#output,
    });
    try {
      this.#output.write(`\n[Codex intervention]\n${prompt.terminal}\n`);
      const text = await terminal.question("Answer: ", { signal });
      return {
        ok: Boolean(text.trim()),
        channel: "terminal",
        text: text.trim(),
        elapsedMs: Date.now() - startedAt,
      };
    } catch {
      return {
        ok: false,
        channel: "terminal",
        text: "",
        error: "Question cancelled or timed out.",
        errorCode: signal.aborted ? "cancelled" : "unavailable",
      };
    } finally {
      terminal.close();
    }
  }
}

export class StaticChannel implements InterventionChannel {
  readonly #answers: ChannelAnswer[];

  constructor(answers: ChannelAnswer[]) {
    this.#answers = [...answers];
  }

  async ask(): Promise<ChannelAnswer> {
    const answer = this.#answers.shift();
    if (!answer) {
      return {
        ok: false,
        channel: "terminal",
        text: "",
        error: "No fixture answer",
      };
    }
    return answer;
  }
}
