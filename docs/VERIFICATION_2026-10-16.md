# Verification: 2026-10-16

Base: remote `main` at `211032ea6b70f1da96fd992f8d192f4f0119fb97`.
Working branch: `codex/dictation-bridge-improvements`.
Local runtime: Windows, Node v24.19.0, pnpm v11.25.0.

| Check | Observed result |
|---|---|
| Frozen offline dependency install, scripts disabled | Passed using the local package store |
| TypeScript host/tests and JavaScript plugin checks | Passed |
| Maintained-source formatting | Passed |
| Automated tests | 53 passed, 0 failed, 0 skipped on Windows |
| Windows cross-process capture mutex | Separate contender excluded while held; acquired after release |
| PowerShell source parsing | Passed |
| Root capture wrapper and stdin session forwarding | Non-recording preview returned the supplied `preview-stdin-check` session ID |
| Response window | Rendered to PNG and visually inspected; typing, choices, review/send, and cancel controls are present |
| Git whitespace check | Passed |

Tests use synthetic history, stub capture processes, and a real packaged MCP process for discovery/invalid-call handling. None of these results claim current-build live microphone or model execution. Historical audit fixtures tested by the suite remain historical evidence.

`doctor` observed PATH CLI `0.141.0` versus generated snapshot `0.147.0-alpha.6.5` and emitted a compatibility warning. This is not the version of the running desktop app. Confirm the selected binary and global shortcut, then perform the controlled live checks in [the upgrade guide](DICTATION_UPGRADE.md).

The installed Codex plugin has not been replaced by this checkout. GitHub CI is defined but has not run remotely; changes have not been pushed. No transcripts, microphone recordings, runtime binaries, or private application data are included in the changes.
