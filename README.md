# Codex Computer-Use Voice Bridge

**A scoped local voice handoff for a computer-use workflow blocked by one missing, non-sensitive input.**

A computer-use agent sometimes reaches a legitimate ambiguity: a required form field, a workflow choice, or a missing fact cannot be inferred safely. The bridge provides a narrow alternative to guessing or abandoning the task.

```text
agent reaches a typed blocker
        ↓
one concise spoken question
        ↓
user answers through the local microphone
        ↓
local speech-to-text
        ↓
validated transcript returns to the same task
```

## Design boundary

This is not general voice control, autonomous browser control, or a replacement for user approval.

It is for one bounded interaction:

- one missing, non-sensitive value
- one scoped question
- a local transcription path
- a visible transcript returned to the active task
- normal policy and submission approval still apply

## Why it matters

Human intervention is often treated as an unstructured chat interruption. This prototype treats it as a typed, resumable runtime event: the agent declares what it is blocked on, requests only the required information, and continues with the response attached to the workflow state.

## Status

Early local prototype. The public direction is to package a minimal reproducible demo with explicit privacy, consent, failure, and fallback behavior.
