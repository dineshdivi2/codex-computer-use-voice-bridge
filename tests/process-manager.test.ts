import assert from "node:assert/strict";
import test from "node:test";
import { appServerSpawnSpec } from "../src/process-manager.ts";

test("uses direct app-server launch outside Windows", () => {
  assert.deepEqual(appServerSpawnSpec("codex", "linux"), {
    command: "codex",
    args: ["app-server"],
  });
});

test("uses a fixed PowerShell bridge for packaged Windows Codex", () => {
  const binary = "C:\\Program Files\\WindowsApps\\OpenAI.Codex\\codex.exe";
  const spec = appServerSpawnSpec(binary, "win32");
  assert.equal(spec.command, "powershell.exe");
  assert.deepEqual(spec.args.slice(0, 6), [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
  ]);
  assert.match(spec.args[6], /start-app-server\.ps1$/);
  assert.equal(spec.args[7], "-CodexBinary");
  assert.equal(spec.args[8], binary);
});
