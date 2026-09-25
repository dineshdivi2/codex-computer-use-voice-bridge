import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { execFile as execFileCallback } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { CodexDictationHistory } from "./codex-dictation-history.ts";
import type { ChannelAnswer, SanitizedPrompt } from "./domain.ts";

const execFile = promisify(execFileCallback);

export interface InterventionChannel {
  ask(prompt: SanitizedPrompt, timeoutMs?: number): Promise<ChannelAnswer>;
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
    this.#launcherScript = options.launcherScript ?? process.env.VOICE_BRIDGE_SCRIPT;
  }

  ask(prompt: SanitizedPrompt, timeoutMs = 110_000): Promise<ChannelAnswer> {
    const run = this.#tail.then(() => this.#askNow(prompt, timeoutMs));
    this.#tail = run.catch(() => undefined);
    return run;
  }

  async #askNow(prompt: SanitizedPrompt, timeoutMs: number): Promise<ChannelAnswer> {
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
      let payload: { ok?: boolean; text?: string; error?: string | null } | undefined;
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
          error: payload?.error ?? "Voice launcher returned no usable JSON result",
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

interface DictationLauncherPayload {
  ok?: boolean;
  text?: string;
  error?: string | null;
  source?: string;
}

export class CodexDictationInterventionAdapter implements InterventionChannel {
  readonly #launcherScript: string;
  readonly #powershellBinary: string;
  readonly #hotkey: string;
  readonly #timeoutMs: number;
  readonly #autoStopSeconds: number;
  readonly #history: CodexDictationHistory;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(options: CodexDictationChannelOptions = {}) {
    this.#launcherScript =
      options.launcherScript ??
      resolve(import.meta.dirname, "..", "scripts", "capture-codex-dictation.ps1");
    this.#powershellBinary = options.powershellBinary ?? "powershell.exe";
    this.#hotkey = options.hotkey ?? "%n";
    this.#timeoutMs = options.timeoutMs ?? 120_000;
    this.#autoStopSeconds = options.autoStopSeconds ?? 0;
    this.#history = options.history ?? new CodexDictationHistory();
  }

  ask(prompt: SanitizedPrompt, timeoutMs = this.#timeoutMs): Promise<ChannelAnswer> {
    const run = this.#tail.then(() => this.#askNow(prompt, timeoutMs));
    this.#tail = run.catch(() => undefined);
    return run;
  }

  async #askNow(prompt: SanitizedPrompt, timeoutMs: number): Promise<ChannelAnswer> {
    const startedAt = Date.now();
    try {
      const baselineIds = await this.#history.snapshotIds();
      const launcherAbort = new AbortController();
      const historyAbort = new AbortController();
      const launcher = this.#askViaLauncher(prompt, timeoutMs, launcherAbort.signal);
      const history = this.#history
        .waitForTranscript({
          baselineIds,
          startedAtMs: startedAt,
          timeoutMs,
          surface: "global",
          signal: historyAbort.signal,
        })
        .then((record) => record.text);

      try {
        const text = await Promise.any([launcher, history]);
        return {
          ok: true,
          channel: "voice",
          text: text.trim(),
          elapsedMs: Date.now() - startedAt,
        };
      } finally {
        launcherAbort.abort();
        historyAbort.abort();
      }
    } catch (error) {
      const detail = error instanceof AggregateError
        ? error.errors
            .map((nested) => (nested instanceof Error ? nested.message : String(nested)))
            .join("; ")
        : error instanceof Error
          ? error.message
          : String(error);
      return {
        ok: false,
        channel: "voice",
        text: "",
        error: detail,
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  async #askViaLauncher(
    prompt: SanitizedPrompt,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<string> {
    const args = [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      this.#launcherScript,
      "-Prompt",
      prompt.spoken,
      "-TimeoutSeconds",
      String(Math.max(15, Math.ceil(timeoutMs / 1_000))),
      "-Hotkey",
      this.#hotkey,
      "-HistoryRoot",
      this.#history.historyRoot,
      "-LegacyHistoryFile",
      this.#history.legacyHistoryFile,
    ];
    if (this.#autoStopSeconds > 0) {
      args.push("-AutoStopSeconds", String(this.#autoStopSeconds));
    }
    const { stdout } = await execFile(this.#powershellBinary, args, {
      timeout: timeoutMs + 5_000,
      windowsHide: true,
      maxBuffer: 1_000_000,
      signal,
    });
    const lines = stdout.trim().split(/\r?\n/).reverse();
    let payload: DictationLauncherPayload | undefined;
    for (const line of lines) {
      try {
        payload = JSON.parse(line) as DictationLauncherPayload;
        break;
      } catch {
        // Ignore diagnostics and keep looking for the final JSON result.
      }
    }
    if (!payload?.ok || !payload.text?.trim()) {
      throw new Error(payload?.error ?? "Codex Dictation launcher returned no transcript");
    }
    return payload.text.trim();
  }
}

export class TerminalFallbackChannel implements InterventionChannel {
  readonly #input: Readable;
  readonly #output: Writable;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(input: Readable = process.stdin, output: Writable = process.stdout) {
    this.#input = input;
    this.#output = output;
  }

  ask(prompt: SanitizedPrompt): Promise<ChannelAnswer> {
    const run = this.#tail.then(() => this.#askNow(prompt));
    this.#tail = run.catch(() => undefined);
    return run;
  }

  async #askNow(prompt: SanitizedPrompt): Promise<ChannelAnswer> {
    const startedAt = Date.now();
    const terminal = createInterface({ input: this.#input, output: this.#output });
    try {
      this.#output.write(`\n[Codex intervention]\n${prompt.terminal}\n`);
      const text = await terminal.question("Answer: ");
      return {
        ok: Boolean(text.trim()),
        channel: "terminal",
        text: text.trim(),
        error: text.trim() ? undefined : "No terminal answer supplied",
        elapsedMs: Date.now() - startedAt,
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
      return { ok: false, channel: "terminal", text: "", error: "No fixture answer" };
    }
    return answer;
  }
}
