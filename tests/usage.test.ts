import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "../src/cli.ts";
import { matchChoice } from "../plugin/job-form-voice-bridge/mcp/answers.mjs";

test("rejects invalid CLI options before launching Codex", () => {
  assert.throws(
    () => parseArgs(["--prompt", "task", "--dictation-timeout-seconds", "301"]),
    /300/,
  );
  assert.throws(
    () => parseArgs(["--prompt", "--no-voice"]),
    /requires a value/,
  );
  assert.throws(
    () => parseArgs(["--prompt", "task", "--typo"]),
    /Unknown option/,
  );
});

test("choice matching supports ordinal answers while preserving Unicode labels", () => {
  assert.equal(
    matchChoice("the second option", ["Immediately", "Within two weeks"]),
    "Within two weeks",
  );
  assert.equal(
    matchChoice("option 3", ["Immediately", "Within two weeks"]),
    undefined,
  );
  assert.equal(matchChoice("हिन्दी", ["English", "हिन्दी"]), "हिन्दी");
  assert.equal(matchChoice("maybe the second one", ["Yes", "No"]), undefined);
  assert.equal(matchChoice("yes", ["Yes", "YES"]), undefined);
});
