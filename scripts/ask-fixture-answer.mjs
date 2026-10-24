import { randomUUID } from "node:crypto";
import { captureDictation } from "../plugin/job-form-voice-bridge/mcp/capture.mjs";

// This launcher is only for the local synthetic fixture, not the live event form
// or the installed job-application plugin. Never save the raw returned transcript.
const url = new URL(process.argv[2]);
if (
  url.protocol !== "http:" ||
  url.hostname !== "127.0.0.1" ||
  url.pathname !== "/"
) {
  throw new Error("Only a loopback fixture origin is allowed.");
}
const origin = url.origin;
const question =
  process.argv[3] ??
  "Which primary area of interest should I select for this event?";
if (
  question.length > 240 ||
  !/interest/i.test(question) ||
  /\b(password|token|api key|bank|passport|otp)\b/i.test(question)
) {
  throw new Error(
    "Ask only a short non-sensitive question about the missing interest.",
  );
}
const state = await fetch(`${origin}/api/state`).then((r) => r.json());
if (
  state.kind !== "synthetic-tech-mixer" ||
  !state.runId ||
  state.interest ||
  state.events.some((e) => e.type === "question-opened")
) {
  throw new Error(
    "A fresh synthetic fixture with a missing preference is required.",
  );
}
const requestId = randomUUID();
async function record(event) {
  const response = await fetch(`${origin}/api/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ ...event, runId: state.runId, requestId }),
  });
  if (!response.ok) throw new Error("Fixture rejected the handoff event.");
}
await record({ type: "question-opened" });
const result = await captureDictation({
  prompt: question,
  context:
    "Local synthetic form test. Click Start Dictation, answer with a listed area, stop with Alt+N, confirm it is stopped, review the text and choose Send answer.",
  taskTitle: "Local Tech Mixer — missing preference",
  timeoutMs: 180_000,
});
if (result.ok) {
  await record({
    type: "answer-returned",
    confirmed: result.confirmed,
    source: result.source,
    captureMayBeActive: result.captureMayBeActive,
  });
} else {
  await record({ type: "question-cancelled" });
}
console.log(JSON.stringify({ ...result, runId: state.runId, requestId }));
