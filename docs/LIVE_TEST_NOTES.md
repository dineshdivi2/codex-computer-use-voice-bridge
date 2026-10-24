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

The subsequent live run completed at `2026-10-16T18:42:57.344Z`: `ok=true`, `confirmed=true`, `source=dictation-reviewed`, and `captureMayBeActive=false` after the user's stopped-state acknowledgement. Elapsed time was 37,573 ms including human interaction. The exact expected-answer check was false. The user subsequently confirmed saying “within two weeks” and reported wrong or missing displayed text. Recognition accuracy failed this check; a successful helper result did not establish a correct answer or App Server task continuation.

## Cable input follow-up — 24 October 2026

The related microphone troubleshooting chat identified a noisy first Intel mic
channel and a usable second channel. Its separate `mic-channel-bridge` project
routes channel 2 into VB-CABLE. This is a plausible contributor to the earlier
recognition failure, not a verified retrospective cause.

On this follow-up, Windows MME enumeration identified CABLE Output as the default
input. The local bridge log recorded today's route startup. A three-second
in-memory sample from CABLE Output measured approximately -23.87 dBFS RMS and
0.513 peak on both channels; no sample audio was saved. This establishes live cable
signal, not which input Codex actually opened, speech quality, or recognition
accuracy.

The first follow-up known-phrase test timed out. The user reported that Start
Dictation displayed “Could not start Dictation,” with the stop checkbox disabled.
That message identifies failure in the shortcut-send path, not a cable-input
failure. The restricted launch environment is a hypothesis, not a confirmed cause.
The fallback now retains the prepared history baseline, enables stop confirmation,
and instructs the user to operate the shortcut manually. It conservatively treats
capture as potentially active until acknowledged and disables timed automatic
stopping for manual fallback. Four Windows regression checks and PowerShell parsing
passed, including the real dialog's manual fallback and send/close guards; these
synthetic checks do not activate the microphone.

A second test outside the restricted environment returned `invalid_choice` at
`2026-10-24T07:42:58.864Z`: a confirmed nonempty answer reached the shared client
but failed finite-choice validation. It was not returned as success. User feedback
is still needed to distinguish automatic shortcut behavior, manual fallback,
recognition quality, and a spoken phrase outside the test's choices.

See [Windows input routing](AUDIO_INPUT.md) for endpoint names and the verification
boundary. No microphone-driver, supervisor, or default-device configuration was
changed in this follow-up.
