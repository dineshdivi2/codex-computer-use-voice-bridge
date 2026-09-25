# Live Verification — 2026-08-11

## Runtime and schemas

- Embedded Codex build: `codex-cli 0.147.0-alpha.6.5`.
- Verified `codex.exe` SHA-256: `FB5C760E14CF8FE86E12E49E8A3E7F237AF06082D6B9FE1E411E463B7229C916`.
- Required sibling `codex-code-mode-host.exe` SHA-256: `E1DD9FA70FEE2BAD00671EB9EF0089CF86CD1A9765CB9A4160082514D7399B95`.
- Required sibling `codex-command-runner.exe` SHA-256: `5BFA04502BC8E2D0CB218A841AD91694AEC7AA52F0EBB446A80D8536360E3ED8`.
- TypeScript and JSON schemas generated successfully and stored under `schemas/`.

The executable copy under `.runtime/` is ignored. The source and copied Codex binary hashes matched. The two sibling binaries were required because the Codex tool router resolves them beside `codex.exe`.

## App-server smoke

The harness completed:

1. Process launch over stdio JSONL.
2. `initialize` / `initialized`.
3. `thread/start`.
4. `turn/start`.
5. Streamed agent output: `HARNESS_LIVE_OK`.
6. `turn/completed`.

## Voice bridge

The local `/health` endpoint returned ready with `tiny.en` and the explicitly selected Intel microphone. Separate live captures exercised the physical microphone and local transcription. In the combined MCP attempt, the bridge received the sanitized question but returned no usable speech; the coordinator recorded `VOICE_TIMEOUT`/fallback behavior and did not guess an approval. A final direct check recorded 14.46 seconds from device index 1 with non-zero audio energy but no transcribable words, confirming that the device/capture path was active while the no-speech safety outcome remained correct.

## Full correlated MCP intervention

Prompted Codex to call `human_intervention.request_human_intervention` exactly once with an approval question.

Observed chain:

1. Codex called the allow-listed MCP tool.
2. The MCP server sent `elicitation/create`.
3. App-server sent `mcpServer/elicitation/request` with request ID `0`, thread `019ff06e-23e1-7870-880f-84bf2bd80662`, and turn `019ff06e-2956-72b2-929c-163fc6694769`.
4. The harness registered the request.
5. The terminal fallback displayed: `May Codex finish the harness smoke test?`
6. The captured answer was `approve once`.
7. The interpreter returned MCP action `accept` with `decision: "approve once"`.
8. The harness responded to request ID `0`.
9. App-server emitted `serverRequest/resolved` for the same thread and request.
10. The same turn continued and Codex replied: `The returned action was accept.`
11. App-server emitted `turn/completed`.

Sanitized audit evidence is stored as `tests/fixtures/live-mcp-terminal-audit.jsonl` and contains exactly one `registered`, one `response-sent`, and one `resolved` event for the request. The real voice no-speech branch is preserved as `tests/fixtures/live-mcp-voice-fallback-audit.jsonl`. Neither contains a prompt body, transcript, audio, or secret.

## Automated verification

- TypeScript typecheck: passed.
- Node test runner: 28/28 tests passed in the closing audit.
- The tests cover the complete acceptance matrix documented in `IMPLEMENTATION_PLAN.md`.

## Honest boundary

The protocol and same-turn continuation were verified end to end. The real voice attempt verified notification plus safe no-speech fallback; its answer capture did not succeed in that combined run. Voice capture/transcription was verified separately against the same existing bridge, so the remaining operational variable is microphone/user speech quality rather than the Codex/MCP correlation path.

## Codex Dictation end-to-end verification

The default voice path was upgraded and verified later on 2026-08-11:

1. A standalone controlled-window smoke automatically started Codex global Dictation.
2. The user stopped it manually with `Alt+N`.
3. The harness selected new rich-history record `1077920c-2642-4e59-b99f-c7bd84db657b`, `surface: global`, with transcript `Okay.`.
4. A full App Server turn then called `human_intervention.request_human_intervention` for the simulated job-form question “What notice period should I enter in this job application?”
5. The user answered and stopped Dictation manually.
6. Rich-history record `270b604c-3700-405a-a5ab-5541e43621a7` completed with transcript `Three months.` and duration `2678 ms`.
7. The harness sent exactly one response for App Server request `0`, received exactly one `serverRequest/resolved`, and the same turn completed with `FORM_VALUE=Three months.`

Sanitized correlation evidence is in `logs/dictation-e2e.jsonl`. It contains `registered`, `response-sent`, and `resolved` events but no prompt or transcript text. The real transcript remains in Codex's own Dictation history by design.
