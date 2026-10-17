import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { JsonLinePeer } from "../src/jsonl-peer.ts";

test("packaged plugin performs initialization/discovery and rejects invalid calls without capture", async () => {
  const child = spawn(
    process.execPath,
    ["plugin/job-form-voice-bridge/mcp/server.mjs"],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  const peer = new JsonLinePeer(child.stdout, child.stdin);
  child.stderr.resume();
  try {
    const initialized = (await peer.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
    })) as { serverInfo: { version: string } };
    assert.equal(initialized.serverInfo.version, "0.2.0");
    const discovery = (await peer.request("tools/list", {})) as {
      tools: {
        name: string;
        inputSchema: { properties: Record<string, unknown> };
      }[];
    };
    assert.equal(discovery.tools.length, 1);
    assert.equal(discovery.tools[0].name, "ask_job_form_voice");
    assert.ok(discovery.tools[0].inputSchema.properties.task);
    await assert.rejects(
      peer.request("tools/call", {
        name: "ask_job_form_voice",
        arguments: { question: "What is your password?" },
      }),
      /Sensitive/,
    );
    assert.deepEqual(await peer.request("resources/list", {}), {
      resources: [],
    });
    assert.deepEqual(await peer.request("ping", {}), {});
  } finally {
    peer.close();
    child.stdin.end();
    child.kill();
  }
});
