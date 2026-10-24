# Voice input follow-up — 24 October 2026

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
