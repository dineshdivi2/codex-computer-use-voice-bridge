---
name: job-form-voice-bridge
description: Use the local Codex Dictation bridge to obtain one missing, non-sensitive value while completing a job-application form. Trigger when a required or consequential form field is unknown or ambiguous after inspecting the form and available user context, and guessing would be unsafe. The bridge asks the user aloud, captures the answer outside the active chat composer, returns the transcript to the same task, and lets work continue. Do not use for ordinary conversation, secrets, credentials, government identifiers, payment data, or submission authorization.
---

# Job Form Voice Bridge

Resolve a genuine job-form blocker with one short voice question, then continue the same task. The user ends Dictation with `Alt+N`; the tool reads the resulting local transcript and does not require the active chat composer.

## Workflow

1. Inspect the visible field label, help text, allowed choices, validation constraints, and values already present on the form.
2. Search the task context and known user-provided profile facts. Never infer an experience claim, eligibility answer, date, compensation value, or other material fact that is not supported.
3. If exactly one non-sensitive value is still missing, call `ask_job_form_voice` once with:
   - `question`: one direct question about that field;
   - `context`: a short, non-sensitive explanation only when it helps;
   - `options`: the exact visible choices when the form supplies two to five choices.
4. Wait for the tool. The local window speaks the prompt and starts Codex Dictation. The user speaks and presses `Alt+N` to stop; the same task receives the transcript automatically.
5. Validate the returned answer against the visible choices and field constraints. If it is unambiguous, fill only that field and continue the previously authorized workflow.
6. If the answer is empty, ambiguous, incompatible, or the tool fails, do not guess. Retry once with a clearer question when useful; otherwise ask in text and preserve the form state.

## Boundaries

- Use the bridge only for a real unknown in an active job-application form workflow. Do not invoke it merely because voice might be convenient.
- Ask for one field value at a time. Keep the spoken prompt concise and include exact options where available.
- Never request passwords, passcodes, API keys, tokens, OTPs, government identifiers, bank or card details, or other secrets through this channel.
- Treat the transcript as an answer to the named field only. It is not permission to submit, send, accept terms, consent to processing, or take any other externally visible action.
- Keep draft, filled, saved, sent, and submitted states distinct. Obtain explicit action-time approval before submission.
- Do not expose the Dictation history identifier or retain transcript copies in plugin logs.

## Tool unavailable or failing

Read [references/operations.md](references/operations.md) only when the tool is unavailable, Dictation does not start, the transcript is not returned, or the plugin itself needs maintenance.
