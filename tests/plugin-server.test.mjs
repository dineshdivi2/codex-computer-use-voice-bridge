import assert from "node:assert/strict";
import test from "node:test";
import { callTool } from "../plugin/job-form-voice-bridge/mcp/server.mjs";

test("plugin validates arguments and sensitive prompts before starting capture", async () => {
  let calls = 0;
  const capture = async () => {
    calls++;
    throw new Error("should not start");
  };
  const params = (arguments_) => ({
    name: "ask_job_form_voice",
    arguments: arguments_,
  });
  await assert.rejects(
    callTool(
      params({ question: "What is your password?" }),
      undefined,
      capture,
    ),
    /Sensitive/,
  );
  await assert.rejects(
    callTool(
      params({ question: "Availability?", unexpected: true }),
      undefined,
      capture,
    ),
    /Unexpected/,
  );
  await assert.rejects(
    callTool(
      params({ question: "Availability?", options: ["Yes", "yes"] }),
      undefined,
      capture,
    ),
    /unique/,
  );
  assert.equal(calls, 0);
});

test("plugin returns only a validated confirmed answer and preserves finite-choice labels", async () => {
  const result = await callTool(
    {
      name: "ask_job_form_voice",
      arguments: {
        question: "When can you start?",
        task: "Availability",
        options: ["Immediately", "Within two weeks"],
      },
    },
    undefined,
    async () => ({
      ok: true,
      text: "second option",
      confirmed: true,
      source: "dictation-reviewed",
    }),
  );
  assert.equal(result.structuredContent.answer, "Within two weeks");
  assert.equal(result.structuredContent.outcome, "answered");
  assert.equal(result.structuredContent.confirmed, true);
});

test("plugin preserves cancelled outcomes and rejects answers outside the options", async () => {
  const params = {
    name: "ask_job_form_voice",
    arguments: { question: "Which option?", options: ["Yes", "No"] },
  };
  const cancelled = await callTool(params, undefined, async () => ({
    ok: false,
    code: "cancelled",
  }));
  assert.equal(cancelled.structuredContent.outcome, "cancelled");
  const invalid = await callTool(params, undefined, async () => ({
    ok: true,
    text: "Maybe",
    confirmed: true,
  }));
  assert.equal(invalid.structuredContent.outcome, "invalid_answer");
});
