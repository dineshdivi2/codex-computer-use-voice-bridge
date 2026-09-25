# Codex Computer-Use Voice Bridge

See [concept and verified status](PUBLIC_STATUS.md). The generated TypeScript protocol snapshot is included. Regenerate both TypeScript and JSON schemas with `npm run schema:generate` after a Codex upgrade.

## Codex Human Intervention Harness

A Codex-first TypeScript host for supervising `codex app-server` turns and safely resolving human-input blockers through Codex Dictation, with terminal and legacy local-Whisper fallbacks.

The repository contains an implemented MVP, generated types from the installed Codex build, deterministic protocol tests, a small MCP server for Default-mode computer-use blockers, and live verification evidence.

## What works

- Starts `codex app-server` over stdio JSONL and performs `initialize` / `initialized`.
- Starts or resumes threads and starts, steers, or interrupts turns.
- Handles the installed build's five relevant server-request families:
  - `item/tool/requestUserInput`
  - `item/commandExecution/requestApproval`
  - `item/fileChange/requestApproval`
  - `item/permissions/requestApproval`
  - `mcpServer/elicitation/request`
- Correlates every answer to the original JSON-RPC request, thread, turn, and item.
- Speaks the actual blocker question, starts Codex Dictation in a controlled response window, and lets the user stop with `Alt+N`.
- Correlates the first new completed global Dictation history record created after the prompt; a controlled paste sink is a secondary recovery path.
- Uses a terminal prompt on timeout or ambiguity and retains the existing `127.0.0.1:8766` local-Whisper bridge as an opt-in mode.
- Exposes `request_human_intervention` as a local MCP tool so Codex can create a standard elicitation in Default mode.
- Redacts spoken prompts, rejects vague approvals, grants only requested permissions, and logs no raw audio or transcript.

See [the high-level design](docs/HIGH_LEVEL_DESIGN.md), [implementation plan](docs/IMPLEMENTATION_PLAN.md), and [live verification report](docs/LIVE_VERIFICATION.md).

## Run

Prerequisites:

- Node.js 24 or newer.
- A working Codex login and an installed `codex` command or explicit Codex binary.
- The Codex desktop app running with global Dictation available. This machine's configured start/stop shortcut is `Alt+N`.
- The legacy local mode additionally needs `C:\path\to\jobs-workspace\voice_bridge\ask-native-voice.ps1`.

```powershell
node --experimental-strip-types src/cli.ts `
  --prompt "Complete the job application. Use request_human_intervention for an unknown required field. Fill resolved fields, but do not submit." `
  --cwd "C:\path\to\trusted\workspace"
```

When the workflow reaches an unknown field, the harness opens a small top-most response window, speaks the contextual question, and starts Codex Dictation. Speak the answer and press `Alt+N` once. No Enter key is required. The answer is returned to the original App Server request, and the same turn continues.

Useful options:

- `--resume <thread-id>` resumes a Codex thread.
- `--model <id>` chooses an exact model.
- `--no-voice` makes the terminal the only intervention channel.
- `--voice-mode dictation|local` selects Codex Dictation (default) or the legacy local faster-whisper bridge.
- `--dictation-hotkey <SendKeys>` overrides `%n`, the `Alt+N` SendKeys expression.
- `--dictation-timeout-seconds <n>` controls the manual response timeout; the default is 120 seconds.
- `--dictation-auto-stop-seconds <n>` restores timed stopping when non-zero; manual stop is the default.
- `--dictation-script <path>` and `--voice-script <path>` override the Dictation and legacy launchers.
- `--no-mcp` disables injection of the blocker MCP server.
- `--codex-bin`, `--mcp-node`, and `--mcp-server` override runtime paths.
- `--audit <path>` selects the sanitized JSONL audit file.

Run a standalone microphone/history smoke test with:

```powershell
npm run dictation:smoke
```

Codex itself persists Dictation transcripts under `%USERPROFILE%\.codex\dictation-history` and the legacy `transcription-history.jsonl`. The harness reads only records created after its own prompt and does not copy transcript text into its audit log.

If a Microsoft Store ACL prevents a child process from executing `codex.exe` in place, copy `codex.exe`, `codex-code-mode-host.exe`, and `codex-command-runner.exe` from the same installed package into one ignored runtime directory. Keeping the siblings together is required for MCP tool execution. Do not commit these binaries.

## Verify

```powershell
npm test
npx tsc --noEmit
```

The repository deliberately has no runtime npm dependencies. The MCP server uses the standard MCP JSON-RPC/JSONL protocol directly, and all Codex payload types come from `codex app-server generate-ts`.

## Protocol artifacts

The checked-in [schema note](schemas/README.md) identifies the exact Codex build and binary hash used to generate `schemas/typescript` and `schemas/json`. Regenerate both directories after any Codex upgrade before changing code.
