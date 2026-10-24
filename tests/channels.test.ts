import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { TerminalFallbackChannel } from "../src/channels.ts";

test("terminal fallback fails promptly without a TTY rather than hanging an MCP caller", async () => {
  const channel = new TerminalFallbackChannel(
    new PassThrough(),
    new PassThrough(),
  );
  const result = await channel.ask({
    spoken: "Question",
    terminal: "Question",
    sensitivity: "normal",
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "unavailable");
});

test("terminal fallback honours cancellation while waiting for an answer", async () => {
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const controller = new AbortController();
  const result = new TerminalFallbackChannel(input, new PassThrough()).ask(
    { spoken: "Question", terminal: "Question", sensitivity: "normal" },
    5_000,
    controller.signal,
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  assert.equal((await result).errorCode, "cancelled");
});
