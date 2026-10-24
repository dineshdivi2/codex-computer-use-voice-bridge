# Local form and voice handoff test

This fixture follows the observed NatWest Tech Mixer field structure, using only
synthetic participant details. The real form was already populated and is not
modified for this test. All 13 observed interest choices are retained; the local
copy deliberately starts without a selected preference. No answer is prescribed
to the model: the user chooses their synthetic attendee's preference when asked.

## What this run can establish

A GPT-6 Luna subagent uses browser tools on the local page, recognizes the missing
preference, invokes the shared Dictation capture client, waits for a reviewed
answer, selects the matching option in the browser, and reaches a local review
checkpoint. User input must return through the capture tool, not a new parent-chat
message or a manually sent “resume.”

This is a browser-agent/shared-capture integration test. It is **not** a test of
native GPT-Live, the installed job-application-only plugin, or a current Codex
App Server MCP elicitation round trip. Request IDs in the fixture correlate its
own handoff events, not App Server request IDs. Those comparisons remain separate.
Windows SAPI speaks the question; Gemini TTS is not installed or invoked.

## Run on Windows with Node 24+

Start the loopback-only fixture:

```powershell
node --experimental-strip-types src/form-fixture.ts
```

It prints its URL, run ID, and process ID. Open the printed URL in the browser.
Provide that URL to the test agent, but do not provide a preferred interest. When
it encounters the missing value, the agent can call:

```powershell
node scripts/ask-fixture-answer.mjs http://127.0.0.1:PORT "Which primary area of interest should I select?"
```

The helper verifies that this is a fresh local fixture before showing a response
window. It does not start the microphone until the user clicks Start Dictation.
The user stops with Alt+N, acknowledges the stopped indicator, reviews the answer,
and chooses Send answer. With 13 visible choices, the capture is free-text; the
agent must map the returned text unambiguously to an actual dropdown option.
If the answer is ambiguous, cancelled, or unavailable, preserve the blank field
and stop rather than guess. Do not invoke the installed job-form plugin here.

The browser must select the user-resolved preference and click **Review local
draft**. Read back the selected value and the visible local-review status. Do not
use shell/HTTP calls to change the form's values as a substitute for browser work.

## Evidence and boundaries

`GET /api/state` reports this fixture's run ID, canonical selected interest, review
checkpoint and ordered events. A successful run should show `question-opened`,
`answer-returned`, `interest-changed`, then `review-reached`, with matching question
IDs. A cancellation cannot be reused as an accepted answer. The server rejects
unconfirmed answers, active capture, foreign origins, unknown choices, and review
before the answer returns. IDs protect correlation, not authentication.

The fixture has no submission endpoint. Upload, consent, and Sign Up controls are
disabled; known synthetic profile inputs are read-only. It binds only to
127.0.0.1 and sets a same-origin content policy. Raw Dictation transcripts are not
written into fixture evidence. The accepted canonical synthetic choice is recorded
so the final field can be independently checked. Codex may retain its normal tool
conversation and Dictation history; this fixture does not alter that retention.

Keep generated evidence under ignored `outputs/` if saving it. Stop the fixture
process after observation. A completed synthetic run does not authorize any real
registration, consent, document upload, or submission.
