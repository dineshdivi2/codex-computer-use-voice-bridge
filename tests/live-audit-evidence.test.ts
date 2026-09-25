import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

async function readJsonLines(name: string): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(resolve(fixtures, name), "utf8");
  return text.trim().split(/\r?\n/).map((line) => JSON.parse(line));
}

test("live MCP evidence resolved one request exactly once with stable correlation", async () => {
  const events = await readJsonLines("live-mcp-terminal-audit.jsonl");
  assert.deepEqual(events.map((event) => event.event), [
    "registered",
    "response-sent",
    "resolved",
  ]);
  const correlations = events.map((event) => [
    event.requestId,
    event.threadId,
    event.turnId,
    event.method,
  ]);
  assert.ok(correlations.every((value) => JSON.stringify(value) === JSON.stringify(correlations[0])));
  assert.equal(events.filter((event) => event.event === "response-sent").length, 1);
  assert.equal(events.filter((event) => event.event === "resolved").length, 1);
  for (const event of events) {
    assert.equal("transcript" in event, false);
    assert.equal("audio" in event, false);
    assert.equal("prompt" in event, false);
  }
});

test("live voice no-speech evidence failed over without manufacturing a decision", async () => {
  const events = await readJsonLines("live-mcp-voice-fallback-audit.jsonl");
  assert.deepEqual(events.map((event) => event.event), ["registered", "voice-fallback"]);
  assert.equal(events.some((event) => "decision" in event), false);
});
