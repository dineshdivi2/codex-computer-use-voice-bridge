import assert from "node:assert/strict";
import test from "node:test";
import { PromptSanitizer } from "../src/prompt-sanitizer.ts";
import { commandApproval, userInputRequest } from "./helpers.ts";

test("never speaks the full command or secret token", () => {
  const prompt = new PromptSanitizer().sanitize(commandApproval() as never);
  assert.equal(prompt.spoken.includes("dangerous-command"), false);
  assert.equal(prompt.spoken.includes("secret-value"), false);
  assert.match(prompt.spoken, /approve once/i);
});

test("redacts secret-like values from spoken user questions", () => {
  const request = userInputRequest(2, "Use token=abcdef1234567890 for which environment?");
  const prompt = new PromptSanitizer().sanitize(request as never);
  assert.equal(prompt.spoken.includes("abcdef1234567890"), false);
  assert.match(prompt.spoken, /REDACTED/);
});
