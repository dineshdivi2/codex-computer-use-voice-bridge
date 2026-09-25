import type { ServerRequest } from "../schemas/typescript/ServerRequest.ts";

export function commandApproval(
  id: string | number = 1,
  overrides: Record<string, unknown> = {},
): ServerRequest {
  return {
    method: "item/commandExecution/requestApproval",
    id,
    params: {
      threadId: "thread-a",
      turnId: "turn-a",
      itemId: `item-${String(id)}`,
      startedAtMs: 1_786_400_000_000,
      command: "dangerous-command --token=secret-value",
      cwd: "C:\\workspace\\private-project",
      ...overrides,
    },
  } as ServerRequest;
}

export function userInputRequest(
  id: string | number = 2,
  question = "Which environment should Codex use?",
): ServerRequest {
  return {
    method: "item/tool/requestUserInput",
    id,
    params: {
      threadId: "thread-a",
      turnId: "turn-a",
      itemId: `item-${String(id)}`,
      autoResolutionMs: null,
      questions: [
        {
          id: "environment",
          header: "Environment",
          question,
          isOther: false,
          isSecret: false,
          options: [
            { label: "Staging", description: "Use the staging environment" },
            { label: "Production", description: "Use production" },
          ],
        },
      ],
    },
  } as ServerRequest;
}

export function permissionRequest(id: string | number = 3): ServerRequest {
  return {
    method: "item/permissions/requestApproval",
    id,
    params: {
      threadId: "thread-a",
      turnId: "turn-a",
      itemId: `item-${String(id)}`,
      environmentId: null,
      startedAtMs: 1_786_400_000_000,
      cwd: "C:\\workspace",
      reason: "Needs package registry access",
      permissions: {
        network: { enabled: true },
        fileSystem: null,
      },
    },
  } as ServerRequest;
}

export function mcpFormRequest(id: string | number = 4): ServerRequest {
  return {
    method: "mcpServer/elicitation/request",
    id,
    params: {
      threadId: "thread-a",
      turnId: "turn-a",
      serverName: "human-intervention",
      mode: "form",
      _meta: null,
      message: "Choose how Codex should continue.",
      requestedSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["Continue", "Stop"] },
        },
        required: ["action"],
      },
    },
  } as ServerRequest;
}
