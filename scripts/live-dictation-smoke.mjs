import { captureDictation } from "../plugin/job-form-voice-bridge/mcp/capture.mjs";
import { mkdir, writeFile } from "node:fs/promises";

const result = await captureDictation({
  prompt:
    "Voice bridge test. Click Start Dictation when ready. Say within two weeks, stop with Alt+N, tick the stopped box, review the answer, then choose Send answer.",
  taskTitle: "Live test - availability",
  options: ["Immediately", "Within two weeks", "Within one month"],
  timeoutMs: 180_000,
});
const report = {
  testedAt: new Date().toISOString(),
  runtime: process.version,
  ok: result.ok,
  confirmed: result.confirmed === true,
  source: result.source ?? null,
  outcome: result.code ?? (result.ok ? "answered" : "failed"),
  expectedAnswerMatches:
    result.text
      ?.toLowerCase()
      .replace(/[^a-z]+/g, " ")
      .trim() === "within two weeks",
  dictationPathObserved: result.source === "dictation-reviewed",
  totalElapsedMs: result.totalElapsedMs ?? null,
  captureMayBeActive: result.captureMayBeActive === true,
  error: result.error ?? null,
};
await mkdir("outputs", { recursive: true });
await writeFile(
  "outputs/live-dictation-smoke.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
