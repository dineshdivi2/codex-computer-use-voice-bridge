import assert from "node:assert/strict";
import test from "node:test";
import { MemoryAuditLog } from "../src/audit-log.ts";
import { StaticChannel, type InterventionChannel } from "../src/channels.ts";
import type { ChannelAnswer, SanitizedPrompt } from "../src/domain.ts";
import { InterventionCoordinator, type ServerResponder } from "../src/intervention-coordinator.ts";
import { commandApproval, userInputRequest } from "./helpers.ts";

class FakeResponder implements ServerResponder {
  readonly responses: Array<{ id: string | number; result: unknown }> = [];
  readonly errors: Array<{ id: string | number; code: number; message: string }> = [];
  respond(id: string | number, result: unknown): void {
    this.responses.push({ id, result });
  }
  respondError(id: string | number, code: number, message: string): void {
    this.errors.push({ id, code, message });
  }
}

class DeferredChannel implements InterventionChannel {
  resolve!: (answer: ChannelAnswer) => void;
  readonly answer = new Promise<ChannelAnswer>((resolve) => {
    this.resolve = resolve;
  });
  async ask(_prompt: SanitizedPrompt): Promise<ChannelAnswer> {
    return this.answer;
  }
}

class RecordingChannel implements InterventionChannel {
  readonly prompts: SanitizedPrompt[] = [];
  readonly #answers: ChannelAnswer[];

  constructor(answers: ChannelAnswer[]) {
    this.#answers = [...answers];
  }

  async ask(prompt: SanitizedPrompt): Promise<ChannelAnswer> {
    this.prompts.push(prompt);
    return this.#answers.shift() ?? {
      ok: false,
      channel: "voice",
      text: "",
      error: "No fixture answer",
    };
  }
}

function makeCoordinator(voice: InterventionChannel, fallback: InterventionChannel) {
  const responder = new FakeResponder();
  const audit = new MemoryAuditLog();
  const coordinator = new InterventionCoordinator({ responder, voice, fallback, audit });
  return { coordinator, responder, audit };
}

test("sends one correlated response and records server resolution", async () => {
  const { coordinator, responder, audit } = makeCoordinator(
    new StaticChannel([{ ok: true, channel: "voice", text: "Staging" }]),
    new StaticChannel([]),
  );
  await coordinator.handleServerRequest(userInputRequest(12));
  assert.deepEqual(responder.responses, [
    {
      id: 12,
      result: { answers: { environment: { answers: ["Staging"] } } },
    },
  ]);
  assert.equal(coordinator.registry.get(12)?.state, "AWAITING_SERVER_RESOLUTION");
  await coordinator.handleNotification({
    method: "serverRequest/resolved",
    params: { threadId: "thread-a", requestId: 12 },
  });
  assert.equal(coordinator.registry.get(12)?.state, "RESOLVED");
  assert.equal(audit.events.filter((event) => event.event === "response-sent").length, 1);
});

test("falls back to terminal after voice timeout", async () => {
  const { coordinator, responder } = makeCoordinator(
    new StaticChannel([{ ok: false, channel: "voice", text: "", error: "timeout" }]),
    new StaticChannel([{ ok: true, channel: "terminal", text: "approve once" }]),
  );
  await coordinator.handleServerRequest(commandApproval(13));
  assert.deepEqual(responder.responses, [{ id: 13, result: { decision: "accept" } }]);
  assert.equal(coordinator.registry.get(13)?.channel, "terminal");
});

test("ambiguous voice input gets an explicit bounded clarification", async () => {
  const voice = new RecordingChannel([
    { ok: true, channel: "voice", text: "yes" },
    { ok: true, channel: "voice", text: "approve once" },
  ]);
  const { coordinator, responder } = makeCoordinator(voice, new StaticChannel([]));
  await coordinator.handleServerRequest(commandApproval(131));
  assert.equal(voice.prompts.length, 2);
  assert.match(voice.prompts[1].spoken, /approve once, approve for session, decline, or cancel/i);
  assert.deepEqual(responder.responses, [{ id: 131, result: { decision: "accept" } }]);
});

test("late voice answer cannot resolve a completed turn", async () => {
  const voice = new DeferredChannel();
  const { coordinator, responder } = makeCoordinator(voice, new StaticChannel([]));
  const handling = coordinator.handleServerRequest(userInputRequest(14));
  await new Promise((resolve) => setImmediate(resolve));
  await coordinator.handleNotification({
    method: "turn/completed",
    params: {
      threadId: "thread-a",
      turn: {
        id: "turn-a",
        items: [],
        itemsView: { type: "full" },
        status: "completed",
        error: null,
        startedAt: null,
        completedAt: null,
        durationMs: null,
      },
    },
  } as never);
  voice.resolve({ ok: true, channel: "voice", text: "Staging" });
  await handling;
  assert.deepEqual(responder.responses, []);
  assert.equal(coordinator.registry.get(14)?.state, "TURN_COMPLETED_BEFORE_RESPONSE");
});

test("disconnect invalidates every pending intervention", async () => {
  const voice = new DeferredChannel();
  const { coordinator, responder } = makeCoordinator(voice, new StaticChannel([]));
  const handling = coordinator.handleServerRequest(userInputRequest(15));
  await new Promise((resolve) => setImmediate(resolve));
  await coordinator.handleDisconnect();
  voice.resolve({ ok: true, channel: "voice", text: "Staging" });
  await handling;
  assert.deepEqual(responder.responses, []);
  assert.equal(coordinator.registry.get(15)?.state, "APP_SERVER_DISCONNECTED");
});

test("concurrent requests cannot consume each other's answer or request id", async () => {
  const voice = new StaticChannel([
    { ok: true, channel: "voice", text: "Staging" },
    { ok: true, channel: "voice", text: "Production" },
  ]);
  const { coordinator, responder } = makeCoordinator(voice, new StaticChannel([]));
  await Promise.all([
    coordinator.handleServerRequest(userInputRequest(21)),
    coordinator.handleServerRequest(userInputRequest(22)),
  ]);
  assert.deepEqual(
    responder.responses.sort((a, b) => Number(a.id) - Number(b.id)),
    [
      { id: 21, result: { answers: { environment: { answers: ["Staging"] } } } },
      { id: 22, result: { answers: { environment: { answers: ["Production"] } } } },
    ],
  );
});
