import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";

export interface ProcessManagerOptions {
  codexBinary?: string;
  cwd?: string;
}

export interface SpawnSpec {
  command: string;
  args: string[];
}

export function appServerSpawnSpec(
  codexBinary: string,
  platform = process.platform,
): SpawnSpec {
  if (platform === "win32") {
    // Microsoft Store apps can reject CreateProcess from Node with EPERM even
    // when the same executable is invokable from PowerShell. PowerShell remains
    // a transparent stdio parent here; no command string includes user input.
    return {
      command: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        fileURLToPath(new URL("../scripts/start-app-server.ps1", import.meta.url)),
        "-CodexBinary",
        codexBinary,
      ],
    };
  }
  return { command: codexBinary, args: ["app-server"] };
}

export class CodexProcessManager extends EventEmitter {
  readonly #options: ProcessManagerOptions;
  #process: ChildProcessWithoutNullStreams | null = null;

  constructor(options: ProcessManagerOptions = {}) {
    super();
    this.#options = options;
  }

  get process(): ChildProcessWithoutNullStreams {
    if (!this.#process) throw new Error("Codex app-server has not been started");
    return this.#process;
  }

  start(): ChildProcessWithoutNullStreams {
    if (this.#process) throw new Error("Codex app-server is already running");
    const executable = this.#options.codexBinary ?? process.env.CODEX_BIN ?? "codex";
    const spec = appServerSpawnSpec(executable);
    const child = spawn(spec.command, spec.args, {
      cwd: this.#options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.#process = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => this.emit("stderr", String(chunk)));
    child.on("error", (error) => this.emit("error", error));
    child.on("exit", (code, signal) => {
      this.#process = null;
      this.emit("exit", { code, signal });
    });
    return child;
  }

  async stop(graceMs = 2_000): Promise<void> {
    const child = this.#process;
    if (!child) return;
    child.stdin.end();
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    const timeout = new Promise<void>((resolve) =>
      setTimeout(() => {
        if (!child.killed) child.kill();
        resolve();
      }, graceMs),
    );
    await Promise.race([exited, timeout]);
  }
}
