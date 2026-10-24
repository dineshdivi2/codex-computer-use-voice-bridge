# Windows input routing for Dictation

This bridge asks the installed Codex desktop app to start Dictation. It does not
open an audio device itself or override the app's microphone selection. A working
response window therefore does not establish that the intended microphone is used.

For the laptop with the diagnosed noisy Intel stereo channel, the intended route is:

```text
Intel Microphone Array, channel 2
  -> local mic-channel-bridge (duplicates the clean channel)
  -> CABLE Input (playback endpoint)
  -> CABLE Output (recording endpoint)
  -> Codex Dictation
```

Use **CABLE Output (VB-Audio Virtual Cable)** as the app microphone, or as the
Windows default input when the app follows that default. Do not select CABLE Input
as the microphone. Do not confuse it with the separate AudioRelay virtual mic.
Keep normal speakers/headphones selected for playback.

The separate `mic-channel-bridge` project supplies audio to the cable. Its desktop
**Start Clean Microphone** and **Stop Clean Microphone** controls start and pause
that route. A selected cable can still be silent if its bridge is stopped or paused.
The microphone supervisor and sign-in task belong to that project; the voice bridge
does not install, start, or change them automatically.

Check the Windows input and any explicit app microphone selection before testing.
Then verify a live signal at CABLE Output, and run the known-phrase test:

```powershell
node scripts/live-dictation-smoke.mjs
```

Click Start Dictation, say “within two weeks,” stop with the configured shortcut,
acknowledge the stopped state, and inspect the displayed answer before sending.
If the dialog reports **Shortcut unavailable**, Windows rejected its shortcut
injection. The answer box and stop checkbox remain usable: focus the answer box,
check the Codex indicator, and use the configured shortcut manually to start/stop.
Default Alt+N is a toggle, so check the indicator before pressing it. Manual
fallback does not use timed automatic stopping. It still requires stop
acknowledgement before sending or closing.

Selecting a dropdown or correcting the transcript tests the fallback flow, not
recognition accuracy. Input levels alone cannot establish speech recognition or
task continuation. The faulty channel is specific to this laptop; do not apply
that channel choice to other devices without checking them.
