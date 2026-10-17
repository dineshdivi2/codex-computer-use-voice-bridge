# Live test follow-up

The first automated launches timed out without an accepted answer. The user subsequently confirmed the response window had appeared while they were away. A later attempt returned `cancelled`; the user reported hearing/listening behavior but was unsure what was captured, and the Codex Dictation visual remained active. The user stopped it with Alt+N.

These observations do not establish successful transcript delivery or task continuation. They exposed a usability/lifecycle gap: closing the answer window did not establish that Codex Dictation had stopped.

The follow-up changes are:

- Launch the response helper as an interactive process and activate its own window.
- Leave the microphone off when the window opens. Start Dictation requires an explicit user action.
- Require the user to check the Codex recording indicator and acknowledge that Dictation is stopped before sending or manually closing the response window.
- Keep the answer sink open on manual Cancel/close until that acknowledgement.
- Do not infer microphone shutdown from receipt of a transcript or from an attempted shortcut toggle.
- Recognize a matching, reviewed history candidate even if the app pasted its text into the sink before history polling completed.
- Preserve conservative capture-state warnings on deadline or disconnection. The bridge still cannot guarantee microphone shutdown through an undocumented Dictation UI/state interface.

Automated verification after these changes: 54 tests passed, including a synthetic test that exercises the real WinForms Send/Close controls before and after stopped-state acknowledgement. Host/plugin type checks, formatting, and PowerShell parsing passed. Synthetic control tests never start the microphone and cannot be accepted as live answers.

Use `node scripts/live-dictation-smoke.mjs` with Node >=24 from the repo to repeat the controlled availability test. It saves outcome flags and timings under ignored `outputs/`, without answer text or audio. The expected sample is “within two weeks.” Opening this window alone does not start recording.

The subsequent live run completed at `2026-10-16T18:42:57.344Z`: `ok=true`, `confirmed=true`, `source=dictation-reviewed`, and `captureMayBeActive=false` after the user's stopped-state acknowledgement. Elapsed time was 37,573 ms including human interaction. The exact expected-answer check was false; confirmation of the spoken/displayed wording is pending. This proves the capture/review/result path ran, not recognition accuracy or App Server task continuation.
