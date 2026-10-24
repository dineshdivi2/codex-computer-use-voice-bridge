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

No native-voice versus bridge end-to-end comparison, new plugin-cache installation,
current-build App Server compatibility test, TTS provider installation, cloud TTS
call, or comparative listening benchmark was performed. The checked-in protocol
snapshot has not been regenerated in this update. Historical audit evidence retains
its original dates. Remote CI results must be reported separately from local checks.
