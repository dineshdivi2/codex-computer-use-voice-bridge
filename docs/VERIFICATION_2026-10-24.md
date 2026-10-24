# Verification — 24 October 2026

## Scope

Publish the maintained Dictation upgrade and current research without claiming
that the full missing-field workflow or a replacement speech provider is proven.
The implementation remains Windows SAPI output plus Codex Dictation input.

## Checks run locally

Using Node 24.22.1 and the repository's pinned pnpm:

```powershell
pnpm run verify
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/check-powershell.ps1
git diff --check
```

- Host and plugin TypeScript checks passed.
- Formatting passed after a formatting-only correction to `mcp/capture.mjs`.
- **56 tests passed**, zero failures or skips, including Windows controls/history/
  cross-process mutex tests. New capture regressions cover strict finite-choice
  rejection and rejection while capture may still be active.
- PowerShell parsing passed.
- Relative links in the updated project/status/research documents resolved.
- Changed publish files were checked for large files and common credential patterns;
  no findings. This bounded check is not a comprehensive secret scanner.

## Observed live evidence

- The default Windows MME input was CABLE Output; a brief in-memory level check
  found a live cable signal. No diagnostic audio was saved.
- The user confirmed the reopened dialog started Dictation on click, stopped with
  Alt+N, and accurately displayed their spoken wording for one sample.
- The sample failed strict choice validation because its wording was not exactly
  a listed label. Do not reinterpret that as an ASR failure or a successful form fill.

See [live notes](LIVE_TEST_NOTES.md) for the earlier failed attempts and the manual
shortcut fallback. The restricted environment explanation is a hypothesis.

## Remaining limits

### Synthetic browser handoff follow-up

The local fixture increment passed 59 tests, host/plugin type checks, formatting,
and PowerShell parsing. A check overlapping the live response window passed 58
tests but failed mutex acquisition; the complete rerun after capture passed 59/59.

GPT-6 Luna completed the synthetic browser form with Data after the helper returned
the reviewed answer, without a new chat message or resume. Independent event-state
inspection confirmed question, answer, selection and review in order, with consent,
upload and submission disabled. The user confirmed using Dictation; the helper's
`typed` source label does not distinguish direct speech insertion from typing or
edits. Speech provenance therefore remains user-confirmed. See
[local form evidence](LOCAL_FORM_TEST.md#observed-run--24-october-2026).

The subsequent native observation mode passed 60 tests, type checks and formatting.
In an active native voice session, the task asked about the missing field and
selected Data after the spoken reply without a manual resume. Local review was
completed after the user ended voice. Server state independently confirmed the
selection, review and external-action boundaries. The current chat model was not
verified, so this is not a controlled same-model comparison. See the
[native findings](NATIVE_VOICE_COMPARISON.md#observed-active-session-result--24-october-2026).

No inactive-session native voice test, new plugin-cache installation,
current-build App Server compatibility test, TTS provider installation, cloud TTS
call, or comparative listening benchmark was performed. The checked-in protocol
snapshot has not been regenerated in this update. Historical audit evidence retains
its original dates. Remote CI results must be reported separately from local checks.
