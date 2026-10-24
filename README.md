# Codex Computer-Use Voice Bridge

See [concept and verified status](PUBLIC_STATUS.md). The generated TypeScript protocol snapshot is included. Regenerate both TypeScript and JSON schemas with `npm run schema:generate` after a Codex upgrade.

## Codex Human Intervention Harness

A Codex-first TypeScript host for supervising `codex app-server` turns and safely resolving human-input blockers through Codex Dictation, with terminal and legacy local-Whisper fallbacks.

The repository contains an implemented MVP, generated types from the installed Codex build, deterministic protocol tests, a small MCP server for Default-mode computer-use blockers, and live verification evidence.

## Start here

This upgrade keeps **Codex Dictation** and adds a shared response window, explicit answer review, typed input, cancellation, cross-process capture coordination, and setup diagnostics. See the [upgrade design and acceptance checks](docs/DICTATION_UPGRADE.md).

For the laptop's clean-channel workaround, use **CABLE Output** as the microphone.
See [Windows input routing and its live checks](docs/AUDIO_INPUT.md); the Dictation
helper does not select an audio device itself.

Requires Windows, Node.js >=24, an installed Codex desktop app with global Dictation enabled, and the same configured shortcut in the bridge and app. Install development tools and inspect setup:

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm doctor
```

The doctor checks the selected runtime and configuration without recording or reading transcript contents. Warnings are unresolved checks, not readiness confirmation. If the protocol snapshot and selected CLI differ, verify/regenerate against the selected binary before relying on the standalone host. The CLI and running desktop app may be different builds.

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
- Speaks the blocker question in a controlled response window. The user explicitly starts Dictation, stops with the configured shortcut (default Alt+N), and confirms it is off before sending or closing.
- Excludes pre-existing and incomplete history, presents a candidate for review, and returns it only after the user chooses Send answer. Multiple candidates require typed resolution.
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

When the workflow reaches an unknown field, the harness opens a small top-most response window, speaks the contextual question, and waits for you to choose Start Dictation. Choose **Start Dictation**, speak the answer, and stop Dictation with its configured shortcut (default `Alt+N`). Tick **I have stopped Dictation**, review/edit the answer, then choose **Send answer**. You can select a visible choice, type instead, retry, or cancel. The host returns the confirmed answer to the original request; verify the subsequent task step independently.

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
pnpm run verify
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/check-powershell.ps1
```

The repository deliberately has no runtime npm dependencies. The MCP server uses the standard MCP JSON-RPC/JSONL protocol directly, and all Codex payload types come from `codex app-server generate-ts`.

Preview the response window without microphone, speech, or history access:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/capture-codex-dictation.ps1 -PreviewImage outputs/response-window.png
```

The standalone host and packaged plugin use one maintained capture implementation. Installing/updating the plugin in Codex is a separate action; editing a checkout does not update an already installed plugin.

## Protocol artifacts

The checked-in [schema note](schemas/README.md) identifies the exact Codex build and binary hash. The generated TypeScript protocol types are included; the larger generated JSON schema snapshot is omitted and can be recreated with `npm run schema:generate`. Regenerate both after any Codex upgrade before changing code.

## What is and is not bundled

The repository includes the host, job-form plugin, Dictation scripts, tests, generated TypeScript protocol types, and sanitized verification traces. The default Codex Dictation path uses these checked-in sources plus an installed Codex app and Node.js 24 or newer. The optional `--voice-mode local` path still depends on the separate `ask-native-voice.ps1` launcher and local faster-whisper service. Installed Codex binaries, private Dictation history, and generated JSON schema snapshots are not bundled.
