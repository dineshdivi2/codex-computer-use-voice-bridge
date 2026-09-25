import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { ThreadAndTurnManager } from "../src/thread-turn-manager.ts";

test("tracks item/started and item/completed within the active turn", () => {
  const client = new EventEmitter();
  const manager = new ThreadAndTurnManager(client as never);
  client.emit("notification", {
    method: "turn/started",
    params: {
      threadId: "thread-a",
      turn: { id: "turn-a" },
    },
  });
  client.emit("notification", {
    method: "item/started",
    params: {
      threadId: "thread-a",
      turnId: "turn-a",
      item: { type: "agentMessage", id: "item-a", text: "", phase: null, memoryCitation: null },
      startedAtMs: 1,
    },
  });
  assert.deepEqual([...manager.activeItemIds], ["item-a"]);
  client.emit("notification", {
    method: "item/completed",
    params: {
      threadId: "thread-a",
      turnId: "turn-a",
      item: { type: "agentMessage", id: "item-a", text: "done", phase: null, memoryCitation: null },
      completedAtMs: 2,
    },
  });
  assert.deepEqual([...manager.activeItemIds], []);
  assert.deepEqual([...manager.completedItemIds], ["item-a"]);
});
