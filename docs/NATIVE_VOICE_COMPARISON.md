# Native voice and the blocked-form requirement

Reviewed 24 October 2026. This is a documentation comparison and an evaluation
brief, not a claim that native Codex voice lacks clarification capabilities.

## The problem to solve

A computer-use task reaches a required field whose value is not available in its
authorized context. Instead of ending with a final message and requiring the user
to return to Codex and restart work, the desired flow is:

1. Recognize that the value is unknown; preserve the pending task and field.
2. Ask one relevant question aloud without another user prompt.
3. Receive and review the user's spoken or typed answer.
4. Validate the value and return it to the originating request.
5. Continue the same workflow and verify the field was filled correctly.

Pausing while waiting for an answer is expected. Losing the continuation or leaving
the question unnoticed is the usability problem. A transcript is a field value,
not authorization to submit a form.

## What official documentation establishes

| Evidence | What it supports | What it does not establish |
| --- | --- | --- |
| [Native ChatGPT Voice](https://learn.chatgpt.com/docs/features/voice) | Voice in supported Codex tasks; natural conversation; task progress, blockers and results brought back to the voice conversation | Guaranteed detection of every missing field; automatic opening of a voice session when none is active |
| [GPT-Live prompting](https://developers.openai.com/api/docs/guides/live-prompting#unclear-names-dates-and-numbers) | The voice model can ask focused clarifications about unclear important details | That every desktop computer-use blocker is connected to this behavior |
| [GPT-Live delegation](https://developers.openai.com/api/docs/guides/live-delegation#keep-updates-accurate-and-useful) | Applications can provide spoken updates when user input is needed during longer tasks | An API capability is not proof of a particular desktop integration |
| [Codex App Server](https://learn.chatgpt.com/docs/app-server) | Structured user-input and MCP elicitation requests, correlation and continuation mechanisms | A resolved request alone does not prove a subsequent browser action succeeded |

Native voice can ask questions. The unverified part is the complete proactive
ask/answer/resume behavior in this particular form-filling workflow. Demos showing
users speaking commands do not settle that question in either direction.

## Project position

The proposed differentiator is a dependable handoff at a missing-information
blocker, with visible review and a correlated continuation. It is not generic voice
input, a claim of unique question-asking, or a replacement computer-use model.

Keep three responsibilities separate:

- The task model identifies the missing fact and writes the question.
- Text-to-speech speaks that question; a better voice does not itself improve the
  reasoning or make the task invoke the handoff.
- Dictation transcribes the reply; validation and the coordinator resume work.

The maintained implementation has shared capture/UI, cancellation and request
correlation. Speech output still uses Windows SAPI. Alternative TTS providers are
research only: see [the TTS shortlist](TTS_OPTIONS_2026-10-24.md).

## Native-versus-bridge acceptance test

Use the same synthetic form and known context for both paths. Omit one required,
non-sensitive value deliberately. Give the initial task instruction once; do not
say “ask me” again when the agent reaches the missing field.

Record these observations independently:

| Check | Passing observation |
| --- | --- |
| Detection | Agent recognizes that the value is unavailable rather than guessing |
| Question | Relevant question is spoken without a follow-up user prompt |
| Answer | Spoken correction reaches the correct waiting task |
| Continuation | Same task fills the intended field without “resume” or a new task instruction |
| Verification | Agent reads back the actual resulting field state |
| Boundaries | No unrelated fields change and no form is submitted |

Repeat with an active native voice session, with no voice session, and with the
bridge. Include a second missing field, a corrected answer, no speech, cancellation,
and two concurrent tasks. Report these cases separately. Never treat a model's
favorable summary, helper success, or request clearance as end-to-end success.

## Observed active-session result — 24 October 2026

The user started native voice in this existing chat. A fresh synthetic fixture in
native mode began with the required preference blank. Browser inspection identified
the missing value; the backend returned a focused question, which the native voice
conversation spoke. The user's spoken Data preference returned to the same task,
and the browser selected Data without a new instruction to resume. The preceding
bridge run's choice was not used as authorization for this run.

The user then asked to conclude the test and ended voice. The backend completed
the local Review action after voice ended and verified the visible success message.
Independent server state confirmed Data selected, review reached, and consent,
upload and submission disabled. The local server was stopped. No real registration
was changed. The native run used neither SAPI nor the shared Dictation helper.

This is evidence that **native voice can deliver a missing-field question and
return a spoken answer that continues browser work in an active session**. For
this simple case, the bridge is not required to avoid a manual resume prompt.
Review completion after voice ended is reported separately from the selection
that occurred during voice. Fixture events prove browser actions, while the
voice conversation establishes the question and answer exchange.

The current chat's task model was not independently verified, so this is not a
controlled GPT-6 Luna versus GPT-6 Luna comparison or a model performance ranking.
Automatic voice startup with no active session, additional missing fields,
corrections, cancellation, no speech and concurrent tasks remain untested. The
project's current App Server MCP path also remains unverified.
