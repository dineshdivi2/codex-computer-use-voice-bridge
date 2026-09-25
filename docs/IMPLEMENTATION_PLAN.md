# Implementation and Rollout Plan

## Phase 0 — protocol and runtime evidence (complete)

- Inspect installed Codex and the existing voice bridge.
- Copy the Microsoft Store runtime only when required by ACLs; verify SHA-256 identity and keep required sibling executables together.
- Generate TypeScript and JSON Schema artifacts from the installed Codex build.
- Record experimental/stable boundaries before writing payload code.

Exit gate: generated `ServerRequest` contains every intended server-request method, and no request/response payload is manually guessed where a generated type exists.

## Phase 1 — app-server host foundation (complete)

- Implement Windows-safe process launch and graceful shutdown.
- Implement a newline-delimited JSON-RPC peer with request/response correlation.
- Complete initialize/initialized, thread start/resume, turn start/steer/interrupt.
- Stream notifications to the host and terminate only on `turn/completed` or connection failure.

Exit gate: a live turn returns a deterministic model message through the harness.

## Phase 2 — safe intervention core (complete)

- Implement pending-request registry and deterministic state transitions.
- Add generated-schema response mapping for input, command, file, permission, and MCP elicitation.
- Add voice-first/terminal-only policy, prompt sanitization, exact approval vocabulary, bounded retry/fallback, and sanitized audit.
- Invalidate stale, cross-thread, post-turn, and post-disconnect responses.

Exit gate: deterministic tests cover accept-once/session, decline/cancel, ambiguity, timeout/fallback, stale answer, disconnect, and concurrency.

## Phase 3 — Default-mode MCP blocker path (complete)

- Expose one local stdio MCP tool: `request_human_intervention`.
- Restrict it to short non-sensitive approval, choice, or text requests.
- Translate calls into standard flat-form `elicitation/create` requests.
- Inject it as a required, enabled, one-tool allow-listed thread config with approval mode `approve` because the tool itself only asks the user and performs no external action.
- Treat MCP decline/cancel/error as fail closed.

Exit gate: a live Codex turn calls the tool, app-server emits `mcpServer/elicitation/request`, the harness responds to the original ID, receives `serverRequest/resolved`, and the same turn completes.

## Phase 4 — Codex Dictation intervention channel (complete)

- Open a controlled Windows response sink so global Dictation never pastes into the browser form or Codex composer.
- Speak the sanitized blocker question and automatically start global Dictation.
- Keep stop control with the user through `Alt+N` by default; retain optional timed stop for diagnostics.
- Baseline rich and legacy Dictation history, wait for a new completed non-empty global transcript, and use the controlled paste only as recovery.
- Serialize sessions, reject stale history, preserve exact request correlation, and keep transcript text out of the harness audit.
- Make this channel the default while retaining terminal and local faster-whisper modes.

Exit gate: a live job-form MCP elicitation speaks the question, captures a manually stopped Dictation transcript from rich history, responds to the original request exactly once, and completes the same turn.

## Phase 5 — production hardening (next)

1. Add an interactive host loop for multiple turns, typed steering, explicit pending-request cancellation, and readable progress rendering.
2. Add durable but non-authority-bearing thread metadata. Never persist a reusable pending approval.
3. Add process restart supervision with backoff; on reconnect, resume only the Codex thread, never an old intervention.
4. Add a secure local visual field for password/MFA/secret handoff that bypasses TTS, transcription, and logs.
5. Add source/latency counters and stronger no-speech diagnostics without weakening exact schema validation.
6. Add Windows tray notifications and a clear “which server/task is asking” display.
7. Add opt-in telemetry counters with no content: latency, channel success, ambiguity, timeout, and fail-closed rate.

## MVP test strategy

### Deterministic protocol tests

- JSONL response correlation and message classification.
- Duplicate request IDs and typed ID distinction.
- Cross-thread/item mismatch and stale registry version.
- Recorded app-server server-request fixture.
- Generated-contract assertion that all five MVP methods exist.
- Generated semantic assertion that turn interruption is cancellation.

### Policy and interpretation tests

- Approve once versus session approval.
- Decline versus cancel.
- Generic “yes” remains ambiguous.
- Observed local ASR variant maps only through the explicit bounded approval grammar.
- Native option mapping by question ID.
- Permission response contains only the requested subset.
- One-field MCP string/enum/boolean forms.
- Secret redaction and no full command in spoken output.

### Lifecycle failure tests

- Voice failure transitions to terminal fallback.
- Late answer after turn completion is rejected.
- App-server disconnect invalidates all pending requests.
- Two concurrent requests cannot consume each other’s answers.
- Unknown request method fails closed.

### MCP contract tests

- Initialize with client elicitation capability.
- List exactly one tool.
- Perform a complete `tools/call` → `elicitation/create` → result round trip.
- Refuse secret-bearing questions.
- Validate the thread-config allow list and required server flag.

### Live gates

- App-server handshake/thread/turn smoke.
- One real Codex Dictation capture with manual `Alt+N` stop and a new rich-history record.
- MCP server startup and tool discovery from a live Codex turn.
- Full correlated intervention with `serverRequest/resolved` and same-turn continuation.
- Real no-speech voice failure and terminal fallback.

## Acceptance matrix

| Scenario | Evidence |
|---|---|
| Start, initialize, start thread/turn | Live app-server smoke and full MCP smoke |
| Missing-information path | Live `request_human_intervention` MCP call |
| Correlated request registration | Sanitized live audit contains request ID, thread, and turn |
| Spoken notification/microphone | Live Codex Dictation capture returned `Three months.` from a completed global rich-history record |
| Transcript validation and schema mapping | Unit tests plus explicit ASR-variant test |
| Original request response | Live request ID `0` response and resolution audit |
| Same turn continues/completes | Live model output after elicitation and `[turn completed]` |
| Exactly once | Registry test plus single `response-sent` and `resolved` audit events |
| Approval scope, decline, cancel, ambiguity | Interpreter tests |
| Timeout/fallback, stale, disconnect, concurrency | Coordinator/registry tests |

## Risks and live-verification assumptions

| Risk or assumption | Current treatment |
|---|---|
| Installed schemas change with Codex updates | Regenerate both schema sets and rerun all tests; pin evidence by binary version/hash. |
| Native `request_user_input` is experimental and unavailable in current Default mode | Use standard MCP elicitation for Default-mode blockers; keep native support isolated behind `experimentalApi`. |
| App/MCP approval prompting may evolve | Only generated server-request methods are handled. Any unknown method fails closed. |
| Windows Store ACL blocks direct child spawn | Fixed PowerShell stdio bridge; optional hash-identical local runtime copy with sibling tool host/runner. |
| Codex Dictation provides no confidence in history | Exact grammar, schema validation, bounded retry, and terminal fallback; never infer an approval. |
| Metadata completes before transcript text is written | Poll until both `status: completed` and non-empty `text`; ignore baseline and composer records. |
| Hardware/noise causes empty transcript | Timeout and terminal fallback; never manufacture a decision. |
| Terminal fallback without a TTY can block | Production host must provide an interactive terminal or UI; live deterministic test used a PTY. |
| Automatic process restart could replay authority | MVP does not auto-replay. Disconnect terminalizes pending requests. |
| Free-text answer could itself contain sensitive content | Tool forbids requesting it; audit never stores transcript; production visual secret handoff remains a separate future channel. |
| MCP elicitation protocol evolves | Server echoes the negotiated protocol version and implements only current standard form elicitation; contract test runs on every change. |
