import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureDictation } from "./capture.mjs";
import { matchChoice } from "./answers.mjs";
import { readFileSync } from "node:fs";

const TOOL_NAME = "ask_job_form_voice";
const SERVER_VERSION = JSON.parse(
  readFileSync(
    new URL("../.codex-plugin/plugin.json", import.meta.url),
    "utf8",
  ),
).version;
let initialized = false;
let inputBuffer = "";
const activeCalls = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function toolDefinition() {
  return {
    name: TOOL_NAME,
    title: "Ask for a Job Form Answer by Voice",
    description:
      "Ask the local user one concise, non-sensitive question when an active job-application form has an unknown or ambiguous field that cannot be resolved from existing context. The tool speaks the question in a dedicated local window, waits for the user to choose Start Dictation, stop with the configured shortcut, acknowledge that recording is stopped, and review/send the answer, and returns the confirmed text to this task. Include exact visible choices when present. Never request credentials, passwords, tokens, OTPs, government identifiers, payment details, or submission authorization. Filling a field is not permission to submit the application.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        task: {
          type: "string",
          minLength: 1,
          maxLength: 100,
          description:
            "Short non-sensitive application/task label displayed in the response window.",
        },
        question: {
          type: "string",
          minLength: 1,
          maxLength: 360,
          description: "One direct question about the unresolved form field.",
        },
        context: {
          type: "string",
          maxLength: 240,
          description: "Optional non-sensitive reason the value is needed.",
        },
        options: {
          type: "array",
          minItems: 2,
          maxItems: 5,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 80 },
          description:
            "Exact visible form choices, when there are two to five.",
        },
      },
      required: ["question"],
    },
    annotations: {
      title: "Ask for a Job Form Answer by Voice",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  };
}

function requireString(value, field, maxLength) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new Error(
      `${field} must be a non-empty string of at most ${maxLength} characters`,
    );
  }
  return value.trim();
}

function containsSensitiveRequest(text) {
  return /\b(password|passcode|secret|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|private[ _-]?key|credit card|debit card|bank account|routing number|cvv|pin|one[ -]?time password|otp|aadhaar|passport( number)?|social security|tax identifier|pan number|government id(entifier)?)\b/i.test(
    text,
  );
}

function buildPrompt(args) {
  const question = requireString(args.question, "question", 360);
  const context =
    args.context === undefined
      ? ""
      : requireString(args.context, "context", 240);
  let options = [];
  if (args.options !== undefined) {
    if (
      !Array.isArray(args.options) ||
      args.options.length < 2 ||
      args.options.length > 5
    ) {
      throw new Error("options must contain two to five choices");
    }
    options = args.options.map((value, index) =>
      requireString(value, `options[${index}]`, 80),
    );
    if (
      new Set(options.map((option) => option.toLocaleLowerCase())).size !==
      options.length
    ) {
      throw new Error("options must be unique");
    }
  }
  const combined = [question, context, args.task ?? "", ...options].join(" ");
  if (containsSensitiveRequest(combined)) {
    throw new Error(
      "Sensitive information is forbidden in the job-form voice bridge",
    );
  }
  return [
    question,
    context ? `Context: ${context}` : "",
    options.length ? `Allowed answers: ${options.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export async function callTool(
  params,
  signal,
  captureClient = captureDictation,
) {
  if (params?.name !== TOOL_NAME)
    throw new Error(`Unknown tool: ${String(params?.name)}`);
  const args = params.arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("Tool arguments must be an object");
  }
  if (
    Object.keys(args).some(
      (key) => !["question", "context", "options", "task"].includes(key),
    )
  )
    throw new Error("Unexpected tool argument");
  if (args.task !== undefined) requireString(args.task, "task", 100);
  const prompt = buildPrompt(args);
  try {
    const capture = await captureClient(
      {
        prompt,
        options: args.options,
        taskTitle: args.task ?? "Job application",
        timeoutMs: 120_000,
      },
      signal,
    );
    if (!capture.ok)
      return {
        content: [
          {
            type: "text",
            text:
              (capture.error ?? "Question could not be completed.") +
              (capture.captureMayBeActive
                ? " If Codex is still recording, stop it with its configured Dictation shortcut."
                : ""),
          },
        ],
        structuredContent: {
          ok: false,
          outcome: capture.code,
          captureMayBeActive: capture.captureMayBeActive === true,
        },
        isError: true,
      };
    const answer = args.options
      ? matchChoice(capture.text, args.options)
      : capture.text;
    if (!answer)
      return {
        content: [
          {
            type: "text",
            text: "The answer did not match a listed choice. Ask again or use typed input.",
          },
        ],
        structuredContent: { ok: false, outcome: "invalid_answer" },
        isError: true,
      };
    return {
      content: [
        {
          type: "text",
          text:
            `Confirmed answer: ${answer}. Recheck the target field before using it.` +
            (capture.captureMayBeActive
              ? " Stop any remaining Codex Dictation recording with its configured shortcut."
              : ""),
        },
      ],
      structuredContent: {
        ok: true,
        outcome: "answered",
        answer,
        source: capture.source,
        confirmed: true,
        totalElapsedMs: capture.totalElapsedMs,
        captureMayBeActive: capture.captureMayBeActive === true,
      },
      isError: false,
    };
  } catch (error) {
    const message =
      "The response helper could not complete this question. Retry or use typed input.";
    return {
      content: [{ type: "text", text: `Voice capture failed: ${message}` }],
      structuredContent: { ok: false, error: message },
      isError: true,
    };
  }
}

async function handleRequest(message) {
  try {
    if (message.method === "initialize") {
      if (initialized) {
        respondError(message.id, -32600, "Server is already initialized");
        return;
      }
      const protocolVersion =
        typeof message.params?.protocolVersion === "string"
          ? message.params.protocolVersion
          : "2025-06-18";
      initialized = true;
      respond(message.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "job-form-voice-bridge", version: SERVER_VERSION },
        instructions:
          "Use ask_job_form_voice only for one unresolved, non-sensitive field in an active job-application form after available context has been checked. Validate the transcript against the form, fill only the resolved field, and continue. Never treat a field answer as authorization to submit or send.",
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
    if (message.method === "resources/list") {
      respond(message.id, { resources: [] });
      return;
    }
    if (message.method === "resources/templates/list") {
      respond(message.id, { resourceTemplates: [] });
      return;
    }
    if (message.method === "tools/call") {
      if (activeCalls.has(message.id)) {
        respondError(message.id, -32600, "Duplicate active request ID");
        return;
      }
      const controller = new AbortController();
      activeCalls.set(message.id, controller);
      try {
        respond(message.id, await callTool(message.params, controller.signal));
      } finally {
        activeCalls.delete(message.id);
      }
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

function acceptLine(line) {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stderr.write("Ignored invalid MCP JSON line\n");
    return;
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    respondError(null, -32600, "Request must be an object");
    return;
  }
  if (message.method === "notifications/cancelled") {
    activeCalls.get(message.params?.requestId)?.abort();
    return;
  }
  if (
    (typeof message.id === "number" || typeof message.id === "string") &&
    typeof message.method === "string"
  )
    void handleRequest(message);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    inputBuffer += chunk;
    if (Buffer.byteLength(inputBuffer) > 65_536) {
      process.stderr.write("MCP input exceeded its size limit\n");
      for (const controller of activeCalls.values()) controller.abort();
      process.stdin.destroy();
      return;
    }
    let newlineIndex = inputBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      acceptLine(inputBuffer.slice(0, newlineIndex).replace(/\r$/, ""));
      inputBuffer = inputBuffer.slice(newlineIndex + 1);
      newlineIndex = inputBuffer.indexOf("\n");
    }
  });
  process.stdin.on("end", () => {
    if (inputBuffer.trim()) acceptLine(inputBuffer);
    for (const controller of activeCalls.values()) controller.abort();
  });
}
