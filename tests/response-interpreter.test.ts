import assert from "node:assert/strict";
import test from "node:test";
import { ResponseInterpreter } from "../src/response-interpreter.ts";
import {
  commandApproval,
  mcpFormRequest,
  permissionRequest,
  userInputRequest,
} from "./helpers.ts";

const interpreter = new ResponseInterpreter();

test("maps exact approval vocabulary without treating vague yes as approval", () => {
  assert.deepEqual(interpreter.interpret(commandApproval() as never, "approve once"), {
    kind: "valid",
    response: { decision: "accept" },
    decision: "accept",
    terminalState: undefined,
  });
  assert.deepEqual(
    interpreter.interpret(commandApproval() as never, "approve for session"),
    {
      kind: "valid",
      response: { decision: "acceptForSession" },
      decision: "acceptForSession",
      terminalState: undefined,
    },
  );
  assert.equal(interpreter.interpret(commandApproval() as never, "yes").kind, "ambiguous");
  assert.equal(
    interpreter.interpret(
      commandApproval() as never,
      "Apro once for this cortex request.",
    ).kind,
    "valid",
  );
  assert.equal(
    interpreter.interpret(
      commandApproval() as never,
      "Approve once for this Codex request. Approve once for this Codex request.",
    ).kind,
    "valid",
  );
});

test("maps decline and cancel distinctly", () => {
  const declined = interpreter.interpret(commandApproval() as never, "decline");
  const cancelled = interpreter.interpret(commandApproval() as never, "cancel");
  assert.equal(declined.kind === "valid" && declined.terminalState, "DECLINED");
  assert.equal(cancelled.kind === "valid" && cancelled.terminalState, "CANCELLED");
});

test("grants only the permissions that app-server requested", () => {
  const result = interpreter.interpret(permissionRequest() as never, "approve for session");
  assert.equal(result.kind, "valid");
  if (result.kind !== "valid") return;
  assert.deepEqual(result.response, {
    permissions: { network: { enabled: true } },
    scope: "session",
  });
});

test("maps a spoken option to the generated request-user-input answer shape", () => {
  const result = interpreter.interpret(userInputRequest() as never, "staging");
  assert.deepEqual(result, {
    kind: "valid",
    response: { answers: { environment: { answers: ["Staging"] } } },
    decision: "user-input-provided",
  });
});

test("supports a one-field MCP elicitation form", () => {
  const result = interpreter.interpret(mcpFormRequest() as never, "continue");
  assert.deepEqual(result, {
    kind: "valid",
    response: { action: "accept", content: { action: "Continue" }, _meta: null },
    decision: "mcp-form-accepted",
  });
});

test("maps the observed local ASR variant into an MCP approval form", () => {
  const request = mcpFormRequest() as never;
  (request as { params: { requestedSchema: unknown } }).params.requestedSchema = {
    type: "object",
    properties: {
      decision: {
        type: "string",
        enum: ["approve once", "approve for session", "decline", "cancel"],
      },
    },
    required: ["decision"],
  };
  const result = interpreter.interpret(
    request,
    "Apro once for this cortex request.",
  );
  assert.deepEqual(result, {
    kind: "valid",
    response: {
      action: "accept",
      content: { decision: "approve once" },
      _meta: null,
    },
    decision: "mcp-form-accepted",
  });
});
