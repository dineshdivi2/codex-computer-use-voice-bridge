import { createInterface } from "node:readline";

type JsonRpcId = string | number;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

interface PendingCall {
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

const TOOL_NAME = "request_human_intervention";
const SERVER_VERSION = "0.1.0";
const DEFAULT_TIMEOUT_MS = 150_000;

let nextRequestId = 1;
let clientSupportsElicitation = false;
let initialized = false;
const pendingCalls = new Map<JsonRpcId, PendingCall>();

function send(message: JsonRpcMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id: JsonRpcId, result: Record<string, unknown>): void {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id: JsonRpcId, code: number, message: string, data?: unknown): void {
  send({
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  });
}

function serverRequest(
  method: string,
  params: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const id = `human-intervention-${nextRequestId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    }, timeoutMs);
    pendingCalls.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    send({ jsonrpc: "2.0", id, method, params });
  });
}

function toolDefinition(): Record<string, unknown> {
  return {
    name: TOOL_NAME,
    title: "Request Human Intervention",
    description:
      "Ask the local user one short, non-secret blocker question. Use especially when a job-application form contains an unknown or ambiguous required field, and also for unexpected computer-use state, a decision requiring human authority, or a step that would otherwise require guessing. Ask only for the missing value and provide visible choices when available. Never request passwords, credentials, tokens, OTPs, government identifiers, payment details, or open-ended conversation. Filling a field does not authorize submitting the application.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: {
          type: "string",
          minLength: 1,
          maxLength: 240,
          description: "One concise question that can be answered immediately.",
        },
        context: {
          type: "string",
          maxLength: 240,
          description: "Optional non-sensitive reason the answer is needed.",
        },
        response_type: {
          type: "string",
          enum: ["approval", "choice", "text"],
          description: "Expected answer shape.",
        },
        options: {
          type: "array",
          minItems: 2,
          maxItems: 5,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 60 },
          description: "Required choices when response_type is choice.",
        },
      },
      required: ["question", "response_type"],
    },
    annotations: {
      title: "Request Human Intervention",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  };
}

function requireString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${field} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

function containsSensitiveRequest(text: string): boolean {
  return /\b(password|passcode|secret|api[ _-]?key|access[ _-]?token|private[ _-]?key|credit card|debit card|bank account|cvv|one[ -]?time password|otp|aadhaar|passport number|social security|tax identifier|pan number)\b/i.test(text);
}

function buildElicitation(args: Record<string, unknown>): Record<string, unknown> {
  const question = requireString(args.question, "question", 240);
  const context = typeof args.context === "string" ? args.context.trim().slice(0, 240) : "";
  if (containsSensitiveRequest(`${question} ${context}`)) {
    throw new Error("Sensitive information is forbidden in the human intervention channel");
  }
  const responseType = requireString(args.response_type, "response_type", 20);
  const message = context ? `${question} Context: ${context}` : question;

  if (responseType === "approval") {
    return {
      message,
      requestedSchema: {
        type: "object",
        properties: {
          decision: {
            type: "string",
            title: "Decision",
            enum: ["approve once", "approve for session", "decline", "cancel"],
            enumNames: ["Approve once", "Approve for session", "Decline", "Cancel"],
          },
        },
        required: ["decision"],
      },
    };
  }

  if (responseType === "choice") {
    if (!Array.isArray(args.options) || args.options.length < 2 || args.options.length > 5) {
      throw new Error("options must contain two to five choices for response_type choice");
    }
    const options = args.options.map((value, index) =>
      requireString(value, `options[${index}]`, 60),
    );
    if (new Set(options).size !== options.length) throw new Error("options must be unique");
    return {
      message,
      requestedSchema: {
        type: "object",
        properties: {
          answer: { type: "string", title: "Answer", enum: options },
        },
        required: ["answer"],
      },
    };
  }

  if (responseType === "text") {
    return {
      message,
      requestedSchema: {
        type: "object",
        properties: {
          answer: {
            type: "string",
            title: "Answer",
            minLength: 1,
            maxLength: 300,
          },
        },
        required: ["answer"],
      },
    };
  }

  throw new Error("response_type must be approval, choice, or text");
}

async function callTool(params: Record<string, unknown> | undefined): Promise<Record<string, unknown>> {
  if (params?.name !== TOOL_NAME) throw new Error(`Unknown tool: ${String(params?.name)}`);
  if (!clientSupportsElicitation) throw new Error("Codex client did not advertise MCP elicitation support");
  const args = params.arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("Tool arguments must be an object");
  }
  const elicitation = buildElicitation(args as Record<string, unknown>);
  const result = await serverRequest("elicitation/create", elicitation);
  const action = typeof result.action === "string" ? result.action : "cancel";
  const content = result.content && typeof result.content === "object" ? result.content : null;
  const summary = action === "accept"
    ? `Human response accepted: ${JSON.stringify(content)}`
    : `Human response ${action}. Do not assume approval or continue the blocked action.`;
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: { action, content },
    isError: action !== "accept",
  };
}

async function handleRequest(message: JsonRpcRequest): Promise<void> {
  try {
    if (message.method === "initialize") {
      const protocolVersion = typeof message.params?.protocolVersion === "string"
        ? message.params.protocolVersion
        : "2025-06-18";
      const clientCapabilities = message.params?.capabilities as Record<string, unknown> | undefined;
      clientSupportsElicitation = Boolean(clientCapabilities?.elicitation);
      initialized = true;
      respond(message.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "codex-human-intervention", version: SERVER_VERSION },
        instructions:
          "Use request_human_intervention for a genuine blocker, especially an unknown or ambiguous required field in a job-application form. Ask one short non-secret question, include two to five visible choices when the form provides them, fill only the resolved field, and continue autonomously. Never treat a field answer as authorization to submit an application or take another externally visible action. Treat decline, cancel, timeout, and errors as fail-closed outcomes.",
      });
      return;
    }
    if (!initialized) throw new Error("Server has not been initialized");
    if (message.method === "ping") {
      respond(message.id, {});
      return;
    }
    if (message.method === "tools/list") {
      respond(message.id, { tools: [toolDefinition()] });
      return;
    }
    if (message.method === "tools/call") {
      respond(message.id, await callTool(message.params));
      return;
    }
    respondError(message.id, -32601, `Method not found: ${message.method}`);
  } catch (error) {
    respondError(
      message.id,
      -32602,
      error instanceof Error ? error.message : "Invalid request",
    );
  }
}

function handleResponse(message: JsonRpcResponse): void {
  const pending = pendingCalls.get(message.id);
  if (!pending) return;
  pendingCalls.delete(message.id);
  if (message.error) pending.reject(new Error(message.error.message));
  else pending.resolve(message.result ?? {});
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  let message: JsonRpcMessage;
  try {
    message = JSON.parse(line) as JsonRpcMessage;
  } catch {
    process.stderr.write("Ignored invalid MCP JSON line\n");
    return;
  }
  if ("id" in message && ("result" in message || "error" in message)) {
    handleResponse(message);
  } else if ("id" in message && "method" in message) {
    void handleRequest(message);
  }
});

lines.on("close", () => {
  for (const pending of pendingCalls.values()) pending.reject(new Error("MCP client disconnected"));
  pendingCalls.clear();
});
