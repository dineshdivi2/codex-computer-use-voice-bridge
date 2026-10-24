# Voice input follow-up — 24 October 2026

- Related chat: “Diagnose laptop microphone.” The separate microphone bridge routes
  Intel channel 2 through VB-CABLE. Windows currently selects CABLE Output; a brief
  in-memory cable-level check confirmed a live signal. No audio was saved.
- Start Dictation failed in the first follow-up dialog. Its shortcut-send failure
  previously left the stop checkbox disabled. Manual shortcut fallback now preserves
  capture preparation and exposes stop confirmation; timed auto-stop is disabled
  for that fallback.
- Verified: four Windows regression checks, PowerShell parsing, changed test file
  formatting, and Git whitespace checks. No claim of improved recognition accuracy.
- The second test outside the restricted environment returned `invalid_choice`.
  A nonempty answer reached validation, but it was not accepted. Next: establish
  from user feedback whether automatic Start worked and what text was displayed.
  If shortcut sending still fails, use the manual shortcut fallback and diagnose
  that path separately from cable routing. Do not change the microphone supervisor
  or driver as part of this dialog investigation.
- The installed plugin cache has not been updated. This follow-up tests the checkout.
  App Server task continuation and a post-reboot microphone route remain unverified.
