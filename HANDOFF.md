# Voice input follow-up — 24 October 2026

## Native comparison preparation

- Added `--native` fixture mode with the same blank preference and external-action
  boundaries. It records browser selection/review without requiring or fabricating
  shared-capture events. Default bridge mode keeps its existing answer guards.
- All 60 tests, host/plugin type checks and formatting passed.
- Native active-session run completed: the question was spoken, the user's spoken
  Data answer returned to this task, and the browser selected Data without resume.
  The user then concluded voice; local review was completed and verified after
  voice ended. No shared capture helper was used. Independent fixture state
  confirmed Data/review and all external-action boundaries remained disabled.
- Sanitized state is in ignored outputs/native-form-2026-10-24.json; the local
  server is stopped. Native voice works for this simple active-session case, so
  the bridge is not necessary for that case. Do not claim automatic voice startup
  or a controlled Luna comparison: the current chat model was not verified.
- Next evaluation cases: no active session, corrections, a second missing field,
  no speech/cancellation, concurrent tasks and the project's App Server path.

## Local synthetic form increment

- Added a loopback-only Tech Mixer fixture with five known synthetic values and
  one missing preference, retaining all 13 observed interest labels. Upload,
  consent and Sign Up are disabled; there is no submission endpoint.
- The fixture helper uses shared capture and keeps the reviewed reply in the
  tool result only. Ordered fixture events contain request IDs and the canonical
  synthetic selection, not a raw Dictation transcript.
- 59 automated tests, host/plugin type checks, formatting, PowerShell parsing and
  launcher syntax checks passed. Loopback tests require network access; the first
  restricted attempt failed with EACCES and the unrestricted check passed.
- Live GPT-6 Luna browser/shared-capture run completed: the helper returned an
  answer, Luna selected Data, and local review was reached without a new chat
  message or resume. Independent server events confirmed the four-step sequence.
- The user confirmed speaking using Dictation, but the helper labelled the answer
  `typed`. Non-programmatic textbox changes currently receive that label even
  when Dictation inserts text directly. Treat speech provenance as user-confirmed,
  not independently verified; separate interaction mode, imported history and
  edits before using source metadata as an input-modality metric.
- A verification run overlapping live capture failed the mutex acquisition test;
  the post-capture rerun passed all 59 tests. Do not run mutex checks during capture.
- This does not establish a native GPT-Live or current App Server MCP elicitation
  end-to-end result. The local fixture server is stopped; the review tab was left
  available. No real registration was changed or submitted.
- Run instructions and boundaries: docs/LOCAL_FORM_TEST.md.

## Prior evidence and research

- Related chat: “Diagnose laptop microphone.” The separate microphone bridge routes
  Intel channel 2 through VB-CABLE. Windows currently selects CABLE Output; a brief
  in-memory cable-level check confirmed a live signal. No audio was saved.
- Start Dictation failed in the first follow-up dialog. Its shortcut-send failure
  previously left the stop checkbox disabled. Manual shortcut fallback now preserves
  capture preparation and exposes stop confirmation; timed auto-stop is disabled
  for that fallback.
- Verified on 24 October: 56 tests, host/plugin type checks, formatting, PowerShell
  parsing, and Git whitespace checks. One standalone recognition sample is
  user-confirmed; there is no general ASR quality benchmark.
- The second test outside the restricted environment returned `invalid_choice`.
  The user confirmed that Start began recording, Alt+N stopped it, and the displayed
  wording matched their speech. Extra wording did not match a fixed test choice.
  Next: compare native voice and this bridge on the complete missing-field loop,
  following docs/NATIVE_VOICE_COMPARISON.md. Do not loosen decision matching based
  on this single sample. Do not change the microphone supervisor or driver.
- TTS options and audition criteria are in docs/TTS_OPTIONS_2026-10-24.md. First
  candidates: local Kokoro and Azure Neural F0. Research only; no provider download,
  synthesis test, credential setup or cloud charges were incurred.
- The installed plugin cache has not been updated. This follow-up tests the checkout.
  App Server task continuation and a post-reboot microphone route remain unverified.
