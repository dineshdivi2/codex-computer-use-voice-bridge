import assert from "node:assert/strict";
import test from "node:test";
import { startFormFixture } from "../src/form-fixture.ts";

async function setup() {
  const fixture = await startFormFixture();
  const event = async (
    value: Record<string, unknown>,
    origin = fixture.url,
  ) => {
    const response = await fetch(`${fixture.url}/api/event`, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ runId: fixture.runId, ...value }),
    });
    await response.json();
    return response.status;
  };
  const state = () => fetch(`${fixture.url}/api/state`).then((r) => r.json());
  return { ...fixture, event, state };
}

test("synthetic form starts without a preference and rejects unrelated origins and submission", async () => {
  const fixture = await setup();
  try {
    const initial = await fixture.state();
    assert.equal(initial.interest, "");
    assert.equal(initial.reviewed, false);
    assert.equal(initial.submissionEnabled, false);
    assert.equal(initial.uploadEnabled, false);
    assert.equal(initial.consentChecked, false);
    assert.equal(
      await fixture.event(
        { type: "question-opened", requestId: "q1" },
        "https://example.com",
      ),
      403,
    );
    assert.equal(
      await fixture.event({
        type: "question-opened",
        requestId: "q1",
        runId: "other",
      }),
      409,
    );
    assert.equal(
      await fixture.event({ type: "interest-changed", value: "Data" }),
      409,
    );
    assert.equal(
      (await fetch(`${fixture.url}/submit`, { method: "POST" })).status,
      404,
    );
    assert.equal((await fixture.state()).events.length, 0);
  } finally {
    await fixture.close();
  }
});

test("synthetic review requires a correlated confirmed stopped answer before the field changes", async () => {
  const fixture = await setup();
  try {
    assert.equal(
      await fixture.event({ type: "question-opened", requestId: "q1" }),
      200,
    );
    assert.equal(
      await fixture.event({ type: "question-opened", requestId: "q1" }),
      409,
    );
    const answer = {
      type: "answer-returned",
      requestId: "q1",
      confirmed: true,
      source: "dictation-reviewed",
      captureMayBeActive: false,
    };
    assert.equal(
      await fixture.event({ ...answer, requestId: "unrelated" }),
      409,
    );
    assert.equal(
      await fixture.event({ ...answer, captureMayBeActive: true }),
      422,
    );
    assert.equal(await fixture.event({ type: "review-reached" }), 409);
    assert.equal(await fixture.event(answer), 200);
    assert.equal(await fixture.event(answer), 409);
    assert.equal(
      await fixture.event({
        type: "interest-changed",
        value: "not a listed option",
      }),
      422,
    );
    assert.equal(
      await fixture.event({ type: "interest-changed", value: "Markets" }),
      200,
    );
    assert.equal(await fixture.event({ type: "review-reached" }), 200);
    const state = await fixture.state();
    assert.equal(state.interest, "Markets");
    assert.equal(state.reviewed, true);
    assert.deepEqual(
      state.events.map((e: { type: string }) => e.type),
      [
        "question-opened",
        "answer-returned",
        "interest-changed",
        "review-reached",
      ],
    );
    assert.equal(state.events[0].requestId, state.events[1].requestId);
    assert.equal(state.consentChecked, false);
    assert.equal(state.submissionEnabled, false);
  } finally {
    await fixture.close();
  }
});

test("cancelled synthetic question cannot be reused as an answer or complete review", async () => {
  const fixture = await setup();
  try {
    await fixture.event({ type: "question-opened", requestId: "q1" });
    await fixture.event({ type: "question-cancelled", requestId: "q1" });
    assert.equal(
      await fixture.event({
        type: "answer-returned",
        requestId: "q1",
        confirmed: true,
        source: "typed",
        captureMayBeActive: false,
      }),
      409,
    );
    assert.equal(
      await fixture.event({ type: "interest-changed", value: "Technology" }),
      409,
    );
    assert.equal(await fixture.event({ type: "review-reached" }), 409);
    assert.equal((await fixture.state()).interest, "");
  } finally {
    await fixture.close();
  }
});
