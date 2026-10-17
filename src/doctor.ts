import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

export interface DoctorCheck {
  name: string;
  status: "pass" | "warning" | "fail";
  message: string;
}
export async function inspectSetup(
  options: {
    codexBinary?: string;
    hotkey?: string;
    launcherScript?: string;
  } = {},
) {
  const checks: DoctorCheck[] = [];
  const add = (name: string, status: DoctorCheck["status"], message: string) =>
    checks.push({ name, status, message });
  add(
    "Node.js",
    Number(process.versions.node.split(".")[0]) >= 24 ? "pass" : "fail",
    `Selected ${process.version}; requires Node >=24.`,
  );
  add(
    "Platform",
    process.platform === "win32" ? "pass" : "fail",
    "The Dictation response window requires Windows.",
  );
  const root = resolve(import.meta.dirname, "..");
  const helper =
    options.launcherScript ??
    join(
      root,
      "plugin",
      "job-form-voice-bridge",
      "scripts",
      "response-window.ps1",
    );
  try {
    await access(helper);
    add("Response window", "pass", "Helper is installed.");
  } catch {
    add(
      "Response window",
      "fail",
      "Response helper is missing. Check your installation or --dictation-script.",
    );
  }
  let snapshotVersion = "unknown";
  try {
    const note = await readFile(join(root, "schemas", "README.md"), "utf8");
    snapshotVersion = /codex-cli ([^`\s]+)/.exec(note)?.[1] ?? "unknown";
    const { stdout } = await promisify(execFile)(
      options.codexBinary ?? process.env.CODEX_BIN ?? "codex",
      ["--version"],
      { timeout: 5_000, windowsHide: true, maxBuffer: 8_192 },
    );
    const selected = /codex-cli ([^\s]+)/.exec(stdout)?.[1] ?? "unknown";
    add(
      "Codex protocol",
      selected !== "unknown" && selected === snapshotVersion
        ? "pass"
        : "warning",
      `Selected CLI: ${selected}; generated snapshot: ${snapshotVersion}. A match is a version check, not a live compatibility test.`,
    );
  } catch {
    add(
      "Codex protocol",
      "warning",
      `Could not inspect the selected CLI. Use --codex-bin. Generated snapshot: ${snapshotVersion}.`,
    );
  }
  try {
    await access(join(homedir(), ".codex", "dictation-history"));
    add(
      "History directory",
      "pass",
      "Rich-history directory exists; no transcript contents were read.",
    );
  } catch {
    add(
      "History directory",
      "warning",
      "History directory is absent. Enable and test global Dictation in the desktop app.",
    );
  }
  add(
    "Dictation controls",
    "warning",
    `Configured SendKeys expression: ${options.hotkey ?? "%n"}. Verify the same global shortcut in Codex; doctor does not start recording.`,
  );
  add(
    "Desktop and microphone",
    "warning",
    "Confirm the Codex app is running and its microphone works. This check cannot verify desktop readiness or microphone access.",
  );
  return { ok: checks.every((check) => check.status !== "fail"), checks };
}
