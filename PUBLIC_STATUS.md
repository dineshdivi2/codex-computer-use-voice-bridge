# Codex Computer-Use Voice Bridge: concept and verified status

Last reviewed: 2026-09-25.

## Concept

An agent working in a computer-use flow may reach a required field whose value it cannot safely infer. This project treats that blocker as a typed, resumable human-input event: ask one concise, non-sensitive question, capture the answer locally, validate it against the field, and resume the same task. The transcript supplies a field value; it never authorizes submission or another externally visible action.

## What the local implementation demonstrated on 2026-08-11

- A TypeScript host supervised `codex app-server` turns and correlated an intervention response with the originating request and turn.
- The default channel spoke the question in a controlled window, started Codex global Dictation, and accepted the user-stopped transcript from Dictation history. Terminal and local speech-to-text fallbacks remain available.
- A live simulated job-form question returned `Three months.` to the same App Server turn. The sanitized audit recorded one registration, response, and resolution; no raw audio or transcript was copied into the harness audit.
- A packaged job-form plugin exposes the narrow one-field workflow. The standalone host and the plugin are related surfaces, with different installation and invocation paths.

## Boundaries and next work

This is a Windows local MVP tied to a verified Codex build and its generated protocol schemas. It is not general voice control, browser automation, or proof of compatibility with later Codex versions. Regenerate schemas against the installed Codex build before relying on it after an upgrade. The next phase is compatibility checks, packaging, and wider failure testing; see `docs/IMPLEMENTATION_PLAN.md` and `docs/LIVE_VERIFICATION.md`.

Never use this channel for secrets, credentials, government or payment identifiers, or submission approval.
