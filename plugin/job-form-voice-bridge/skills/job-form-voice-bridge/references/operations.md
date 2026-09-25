# Operations and troubleshooting

## Data flow

1. The `ask_job_form_voice` MCP tool validates the question and blocks sensitive prompts.
2. It launches the bundled `scripts/capture-codex-dictation.ps1` in a serialized local process.
3. A topmost, dedicated text box receives the global Codex Dictation action, so the active task composer is not used.
4. The script snapshots existing transcript identifiers before capture, watches `%USERPROFILE%\.codex\dictation-history` and the legacy JSONL history, and selects the earliest new completed global transcript after capture starts.
5. The MCP result returns the answer and capture source to the waiting Codex task. Raw audio is not handled by the plugin.

The tool blocks until capture succeeds, times out, or the window is closed. A successful tool call resumes the same model turn; it does not create a new task or send a chat message on the user's behalf.

## Expected interaction

- Codex speaks the concise question using the local Windows SAPI voice.
- Dictation starts with the configured global `Alt+N` shortcut.
- The user speaks and presses `Alt+N` once to stop.
- Transcription can take several seconds. The window closes when the result appears in Dictation history or stabilizes in the dedicated paste sink.

## Failure checks

- If Dictation remains active after an error or manual window close, press `Alt+N` once.
- Confirm Codex Dictation still uses the global `Alt+N` shortcut.
- Confirm a new completed entry appears under `%USERPROFILE%\.codex\dictation-history`.
- Start a new Codex task after installing or updating the plugin so its skill and MCP server are loaded.
- If the MCP server cannot launch PowerShell, confirm Windows PowerShell 5.1 exists at `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`.

## Maintenance source

The original development harness is `C:\path\to\workspace\codex-human-intervention-harness`. The installed plugin is self-contained; update and validate the plugin copy before reinstalling it from the personal marketplace.
