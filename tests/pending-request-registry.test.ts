import assert from "node:assert/strict";
import test from "node:test";
import { correlationFromRequest } from "../src/domain.ts";
import { PendingRequestRegistry } from "../src/pending-request-registry.ts";
import { commandApproval, userInputRequest } from "./helpers.ts";

test("rejects duplicate ids and cross-thread correlation", () => {
  const registry = new PendingRequestRegistry(() => 100);
  const request = commandApproval(1) as never;
  registry.register(request, null);
  assert.throws(() => registry.register(request, null), /Duplicate/);
  assert.throws(
    () =>
      registry.assertRespondable({
        ...correlationFromRequest(request),
        threadId: "wrong-thread",
      }),
    /Correlation mismatch/,
  );
});

test("keeps concurrent request correlations independent", () => {
  const registry = new PendingRequestRegistry(() => 100);
  registry.register(commandApproval(1) as never, null);
  registry.register(userInputRequest(2) as never, null);
  assert.equal(registry.listActive().length, 2);
  registry.resolveFromServer("thread-a", 1);
  assert.equal(registry.get(1)?.state, "RESOLVED");
  assert.equal(registry.get(2)?.state, "REGISTERED");
});

test("rejects late answers after turn completion", () => {
  const registry = new PendingRequestRegistry(() => 100);
  const request = userInputRequest(2) as never;
  registry.register(request, null);
  registry.completeTurn("thread-a", "turn-a");
  assert.throws(
    () => registry.assertRespondable(correlationFromRequest(request)),
    /already TURN_COMPLETED_BEFORE_RESPONSE/,
  );
});
