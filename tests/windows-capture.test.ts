import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const windows = process.platform === "win32";
const ps = process.env.SystemRoot
  ? join(
      process.env.SystemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    )
  : "powershell.exe";
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const library = resolve(
  "plugin/job-form-voice-bridge/scripts/dictation-history.ps1",
);

test(
  "manual shortcut fallback exposes stop controls and prevents send/close until stopped",
  { skip: !windows },
  async () => {
    const response = resolve("scripts/capture-codex-dictation.ps1");
    const output = await powershell(`& ${quote(response)} -VerifyControls`);
    const result = JSON.parse(output);
    assert.equal(result.uiCheckPassed, true);
    assert.equal(result.syntheticOnly, true);
    assert.equal(result.ok, false);
    assert.equal(result.captureMayBeActive, false);
  },
);
async function powershell(code: string) {
  return (
    await promisify(execFile)(
      ps,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `$ErrorActionPreference='Stop'; ${code}`,
      ],
      { windowsHide: true, timeout: 10_000 },
    )
  ).stdout.trim();
}

test(
  "Windows history selection excludes incomplete/partial baselines and unrelated surfaces",
  { skip: !windows },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "voice-history-contract-"));
    try {
      const rich = join(root, "rich");
      await mkdir(rich);
      await mkdir(join(rich, "inflight"));
      await mkdir(join(rich, "partial"));
      await writeFile(
        join(rich, "inflight", "metadata.json"),
        JSON.stringify({
          id: "old",
          status: "recording",
          createdAtMs: Date.now(),
        }),
      );
      await writeFile(join(rich, "partial", "metadata.json"), "{");
      const code = `
      . ${quote(library)}
      $rich=${quote(rich)}; $legacy=${quote(join(root, "legacy.jsonl"))}
      $baseline=Get-DictationBaseline -HistoryRoot $rich -LegacyHistoryFile $legacy
      $start=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      @{id='old';status='completed';surface='global';createdAtMs=$start;text='old answer'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $rich 'inflight/metadata.json')
      @{id='partial';status='completed';surface='global';createdAtMs=$start;text='partial answer'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $rich 'partial/metadata.json')
      [void](New-Item -ItemType Directory -Path (Join-Path $rich 'composer'))
      @{id='composer';status='completed';surface='composer';createdAtMs=$start;text='composer answer'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $rich 'composer/metadata.json')
      @{id='composer';createdAtMs=$start;text='composer answer'} | ConvertTo-Json -Compress | Set-Content -LiteralPath $legacy
      $candidates=@(Get-DictationCandidates -HistoryRoot $rich -LegacyHistoryFile $legacy -BaselineIds $baseline -StartedAtMs $start)
      [Console]::WriteLine($candidates.Count)
    `;
      assert.equal(await powershell(code), "0");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "Windows history returns all eligible records so the UI can refuse ambiguous selection",
  { skip: !windows },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "voice-history-ambiguity-"));
    try {
      for (const id of ["one", "two"]) {
        await mkdir(join(root, id));
        await writeFile(
          join(root, id, "metadata.json"),
          JSON.stringify({
            id,
            surface: "global",
            status: "completed",
            createdAtMs: Date.now(),
            text: id,
          }),
        );
      }
      const output = await powershell(
        `. ${quote(library)}; $ids=[System.Collections.Generic.HashSet[string]]::new(); @(Get-DictationCandidates -HistoryRoot ${quote(root)} -LegacyHistoryFile ${quote(join(root, "absent"))} -BaselineIds $ids -StartedAtMs 0).Count`,
      );
      assert.equal(output, "2");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "Windows Dictation mutex excludes a separate process and releases on close",
  { skip: !windows, timeout: 15_000 },
  async () => {
    const child = spawn(
      ps,
      [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `$ErrorActionPreference='Stop'; . ${quote(library)}; $m=New-DictationMutex; if (-not (Enter-DictationMutex $m)) {exit 2}; [Console]::WriteLine('locked'); [Console]::Out.Flush(); [void][Console]::In.ReadLine(); $m.ReleaseMutex(); $m.Dispose()`,
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    try {
      await new Promise<void>((resolveReady, reject) => {
        child.stdout.once("data", () => resolveReady());
        child.once("error", reject);
        child.once("exit", (code) => {
          if (code) reject(new Error(`Lock holder failed: ${code}`));
        });
      });
      const contender = `. ${quote(library)}; $m=New-DictationMutex; $held=Enter-DictationMutex $m; [Console]::WriteLine($held); if($held){$m.ReleaseMutex()}; $m.Dispose()`;
      assert.equal(await powershell(contender), "False");
      const exited = new Promise((resolveExit) =>
        child.once("exit", resolveExit),
      );
      child.stdin.end("release\n");
      await exited;
      assert.equal(await powershell(contender), "True");
    } finally {
      child.kill();
    }
  },
);
