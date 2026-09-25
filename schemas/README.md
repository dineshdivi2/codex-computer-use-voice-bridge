# Generated Codex app-server schemas

These files were generated from the Codex desktop app's embedded Windows binary,
`codex-cli 0.147.0-alpha.6.5`, on 2026-08-11. They are checked in as protocol
evidence and must not be edited by hand.

The Microsoft Store package ACL prevented Node from spawning the binary in
place. The live harness used a SHA-256-identical copy in the ignored `.runtime/`
directory. At verification time both hashes were
`FB5C760E14CF8FE86E12E49E8A3E7F237AF06082D6B9FE1E411E463B7229C916`.

Regenerate after a Codex update:

```powershell
codex app-server generate-ts --out ./schemas/typescript
codex app-server generate-json-schema --out ./schemas/json
```

The harness imports the generated TypeScript request and response types. Any
protocol change must start by regenerating these artifacts and rerunning the
fixture and live-contract tests.
