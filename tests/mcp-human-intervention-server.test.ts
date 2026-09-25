import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { JsonLinePeer } from "../src/jsonl-peer.ts";
import { humanInterventionMcpConfig } from "../src/mcp-config.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = resolve(projectRoot, "src", "mcp-human-intervention-server.ts");

test("MCP server performs a correlated elicitation round trip", async () => {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", serverScript],
    { cwd: projectRoot, stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  );
  const peer = new JsonLinePeer(child.stdout, child.stdin);
  try {
    const initialized = await peer.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: { elicitation: {} },
      clientInfo: { name: "test-client", version: "1.0.0" },
    }) as Record<string, unknown>;
    assert.equal(initialized.protocolVersion, "2025-06-18");
    peer.notify("notifications/initialized");

    const listed = await peer.request("tools/list", {}) as {
      tools: Array<{ name: string }>;
    };
    assert.deepEqual(listed.tools.map((tool) => tool.name), ["request_human_intervention"]);

    const requestReceived = once(peer, "serverRequest");
    const call = peer.request("tools/call", {
      name: "request_human_intervention",
      arguments: {
        question: "May Codex continue with the local action?",
        response_type: "approval",
      },
    });
    const [request] = await requestReceived as [{ id: string; method: string; params: Record<string, unknown> }];
    assert.equal(request.method, "elicitation/create");
    assert.equal((request.params.requestedSchema as { type: string }).type, "object");
    peer.respond(request.id, {
      action: "accept",
      content: { decision: "approve once" },
    });

    const result = await call as {
      isError: boolean;
      structuredContent: { action: string; content: Record<string, unknown> };
    };
    assert.equal(result.isError, false);
    assert.deepEqual(result.structuredContent, {
      action: "accept",
      content: { decision: "approve once" },
    });

    await assert.rejects(
      peer.request("tools/call", {
        name: "request_human_intervention",
        arguments: {
          question: "Please say the API key",
          response_type: "text",
        },
      }),
      /Sensitive information is forbidden/,
    );
  } finally {
    peer.close();
    child.kill();
    await once(child, "exit").catch(() => undefined);
  }
});

test("thread config injects one required, allow-listed local MCP server", () => {
  const config = humanInterventionMcpConfig({
    nodeBinary: process.execPath,
    serverScript,
  }) as {
    mcp_servers: {
      human_intervention: Record<string, unknown>;
    };
  };
  assert.deepEqual(config.mcp_servers.human_intervention.enabled_tools, [
    "request_human_intervention",
  ]);
  assert.equal(config.mcp_servers.human_intervention.required, true);
  assert.equal(config.mcp_servers.human_intervention.default_tools_approval_mode, "approve");
});
