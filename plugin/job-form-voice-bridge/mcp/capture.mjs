import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { matchChoice } from "./answers.mjs";

const helper = fileURLToPath(
  new URL("../scripts/capture-codex-dictation.ps1", import.meta.url),
);
const powershell = process.env.SystemRoot
  ? join(
      process.env.SystemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    )
  : "powershell.exe";
const failure = (code, error, extra = {}) => ({
  ok: false,
  code,
  error,
  ...extra,
});

export function parseCaptureOutput(stdout, sessionId, choices = []) {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (!value || typeof value.ok !== "boolean") continue;
    if (value.syntheticOnly === true)
      return failure(
        "unconfirmed",
        "Synthetic UI checks are not live answers.",
      );
    if (value.sessionId !== sessionId)
      return failure(
        "session_mismatch",
        "The response did not belong to this capture session.",
      );
    if (!value.ok)
      return failure(
        ["cancelled", "timeout", "unavailable"].includes(value.code)
          ? value.code
          : "capture_failed",
        value.code === "cancelled"
          ? "Question cancelled."
          : "No confirmed answer was returned. Retry or use typed input.",
        { captureMayBeActive: value.captureMayBeActive === true },
      );
    if (
      value.confirmed !== true ||
      typeof value.text !== "string" ||
      !value.text.trim()
    ) {
      return failure(
        "unconfirmed",
        "Review and confirm an answer in the response window.",
      );
    }
    if (value.captureMayBeActive === true)
      return failure(
        "capture_active",
        "Stop Dictation before sending an answer.",
        {
          captureMayBeActive: true,
        },
      );
    const text = choices.length
      ? matchChoice(value.text, choices)
      : value.text.trim();
    if (!text)
      return failure(
        "invalid_choice",
        "The answer must match one of the listed choices.",
      );
    return {
      ok: true,
      text,
      confirmed: true,
      source: value.source === "typed" ? "typed" : "dictation-reviewed",
      totalElapsedMs: Number.isFinite(value.totalElapsedMs)
        ? value.totalElapsedMs
        : null,
      captureMayBeActive: value.captureMayBeActive === true,
    };
  }
  return failure(
    "invalid_output",
    "The response helper returned no valid result.",
  );
}

/** One FIFO per client; the helper also acquires a Windows session-wide mutex. */
export function createCaptureClient(options = {}) {
  let tail = Promise.resolve();
  return async function capture(request, signal) {
    const timeoutMs = request.timeoutMs ?? 120_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
      return failure(
        "invalid_request",
        "Capture timeout must be between 1 and 300000 milliseconds.",
      );
    }
    const deadline = AbortSignal.timeout(timeoutMs);
    const activeSignal = signal
      ? AbortSignal.any([signal, deadline])
      : deadline;
    const run = tail.then(async () => {
      if (activeSignal.aborted)
        return failure(
          signal?.aborted ? "cancelled" : "timeout",
          "Question no longer active.",
        );
      const directory = await mkdtemp(join(tmpdir(), "codex-voice-session-"));
      const sessionId = randomUUID();
      const cancelFile = join(directory, "cancel");
      try {
        return await new Promise((resolve) => {
          let child;
          let output = "";
          let overflow = false;
          let killTimer;
          let finished = false;
          const finish = (result) => {
            if (finished) return;
            finished = true;
            clearTimeout(killTimer);
            activeSignal.removeEventListener("abort", cancel);
            resolve(result);
          };
          const cancel = () => {
            void writeFile(cancelFile, "cancel", { flag: "wx" }).catch(
              () => {},
            );
            // Give WinForms time to close and release its named mutex before forceful cleanup.
            killTimer ??= setTimeout(() => child?.kill(), 2_000);
          };
          try {
            if (activeSignal.aborted) {
              finish(
                failure(
                  signal?.aborted ? "cancelled" : "timeout",
                  "Question no longer active.",
                ),
              );
              return;
            }
            const payload = {
              ...request,
              hotkey:
                request.hotkey ?? process.env.CODEX_DICTATION_HOTKEY ?? "%n",
              sessionId,
              cancelFile,
              timeoutMs,
            };
            child = options.spawnCapture
              ? options.spawnCapture(payload)
              : spawn(
                  options.powershellBinary ?? powershell,
                  [
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    options.launcherScript ?? helper,
                    "-RequestFromStdin",
                  ],
                  // This helper owns an interactive response window, not a background job.
                  { windowsHide: false, stdio: ["pipe", "pipe", "pipe"] },
                );
            child.stdout.setEncoding("utf8");
            child.stdout.on("data", (chunk) => {
              if (output.length + chunk.length > 65_536) {
                overflow = true;
                child.kill();
              } else output += chunk;
            });
            // Never include helper stderr: OS errors can contain request text or private paths.
            child.stderr.resume();
            child.stdin.on("error", () => {});
            child.on("error", () =>
              finish(
                failure(
                  "unavailable",
                  "Unable to start the Windows response helper.",
                ),
              ),
            );
            child.on("close", () => {
              const parsed = parseCaptureOutput(
                output,
                sessionId,
                request.options,
              );
              if (activeSignal.aborted)
                return finish(
                  failure(
                    signal?.aborted ? "cancelled" : "timeout",
                    "Question no longer active.",
                    {
                      captureMayBeActive:
                        "captureMayBeActive" in parsed
                          ? parsed.captureMayBeActive === true
                          : true,
                    },
                  ),
                );
              finish(
                overflow
                  ? failure(
                      "output_limit",
                      "Response helper exceeded its output limit.",
                    )
                  : parsed,
              );
            });
            activeSignal.addEventListener("abort", cancel, { once: true });
            child.stdin.end(`${JSON.stringify(payload)}\n`);
            if (activeSignal.aborted) cancel();
          } catch {
            finish(
              failure(
                "unavailable",
                "Unable to start the Windows response helper.",
              ),
            );
          }
        });
      } finally {
        await rm(directory, { recursive: true, force: true, maxRetries: 3 });
      }
    });
    tail = run.catch(() => {});
    return run;
  };
}

export const captureDictation = createCaptureClient();
