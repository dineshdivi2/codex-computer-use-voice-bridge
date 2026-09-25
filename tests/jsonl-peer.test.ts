import assert from "node:assert/strict";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { JsonLinePeer } from "../src/jsonl-peer.ts";

test("JSONL peer correlates client request responses", async () => {
  const serverOutput = new PassThrough();
  const clientOutput = new PassThrough();
  clientOutput.setEncoding("utf8");
  const peer = new JsonLinePeer(serverOutput, clientOutput);

  const written = once(clientOutput, "data");
  const pending = peer.request("initialize", { clientInfo: { name: "test" } });
  const [chunk] = await written;
  const request = JSON.parse(String(chunk));
  assert.equal(request.method, "initialize");
  serverOutput.write(`${JSON.stringify({ id: request.id, result: { ok: true } })}\n`);
  assert.deepEqual(await pending, { ok: true });
  peer.close();
});

test("JSONL peer distinguishes server requests and notifications", async () => {
  const serverOutput = new PassThrough();
  const clientOutput = new PassThrough();
  const peer = new JsonLinePeer(serverOutput, clientOutput);
  const serverRequest = once(peer, "serverRequest");
  const notification = once(peer, "notification");

  serverOutput.write(`${JSON.stringify({ method: "item/tool/requestUserInput", id: 99, params: {} })}\n`);
  serverOutput.write(`${JSON.stringify({ method: "turn/completed", params: {} })}\n`);

  assert.equal((await serverRequest)[0].id, 99);
  assert.equal((await notification)[0].method, "turn/completed");
  peer.close();
});
