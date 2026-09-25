import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TOOL_NAME = "ask_job_form_voice";
const SERVER_VERSION = JSON.parse(
  readFileSync(new URL("../.codex-plugin/plugin.json", import.meta.url), "utf8"),
).version;
const CAPTURE_TIMEOUT_SECONDS = 120;
const PROCESS_GRACE_MS = 15_000;
const POWERSHELL = `${process.env.SystemRoot || "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const CAPTURE_SCRIPT = fileURLToPath(new URL("../scripts/capture-codex-dictation.ps1", import.meta.url));

let initialized = false;
let inputBuffer = "";
let captureTail = Promise.resolve();

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
      "Ask the local user one concise, non-sensitive question when an active job-application form has an unknown or ambiguous field that cannot be resolved from existing context. The tool speaks the question, starts Codex Dictation in a dedicated local window, waits for the user to stop with Alt+N, and returns the transcript to this task. Include exact visible choices when present. Never request credentials, passwords, tokens, OTPs, government identifiers, payment details, or submission authorization. Filling a field is not permission to submit the application.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
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
          description: "Exact visible form choices, when there are two to five.",
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
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${field} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value.trim();
}

function containsSensitiveRequest(text) {
  return /\b(password|passcode|secret|api[ _-]?key|access[ _-]?token|refresh[ _-]?token|private[ _-]?key|credit card|debit card|bank account|routing number|cvv|pin|one[ -]?time password|otp|aadhaar|passport( number)?|social security|tax identifier|pan number|government id(entifier)?)\b/i.test(text);
}

function buildPrompt(args) {
  const question = requireString(args.question, "question", 360);
  const context = args.context === undefined ? "" : requireString(args.context, "context", 240);
  let options = [];
  if (args.options !== undefined) {
    if (!Array.isArray(args.options) || args.options.length < 2 || args.options.length > 5) {
      throw new Error("options must contain two to five choices");
    }
    options = args.options.map((value, index) => requireString(value, `options[${index}]`, 80));
    if (new Set(options.map((option) => option.toLocaleLowerCase())).size !== options.length) {
      throw new Error("options must be unique");
    }
  }
  const combined = [question, context, ...options].join(" ");
  if (containsSensitiveRequest(combined)) {
    throw new Error("Sensitive information is forbidden in the job-form voice bridge");
  }
  return [
    question,
    context ? `Context: ${context}` : "",
    options.length ? `Allowed answers: ${options.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
}

function parseCaptureOutput(stdout) {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const result = JSON.parse(lines[index]);
      if (result && typeof result === "object" && typeof result.ok === "boolean") return result;
    } catch {
      // PowerShell or the runtime may emit non-JSON status lines before the final record.
    }
  }
  throw new Error("The Dictation helper did not return a valid result");
}

function launchCapture(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(POWERSHELL, [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      CAPTURE_SCRIPT,
      "-Prompt",
      prompt,
      "-TimeoutSeconds",
      String(CAPTURE_TIMEOUT_SECONDS),
      "-Hotkey",
      "%n",
    ], { windowsHide: false, stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(
        "The Dictation helper exceeded its time limit. Press Alt+N once if Dictation is still active.",
      )));
    }, CAPTURE_TIMEOUT_SECONDS * 1000 + PROCESS_GRACE_MS);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      finish(() => reject(new Error(`Unable to launch the local Dictation helper: ${error.message}`)));
    });
    child.on("close", (code) => {
      finish(() => {
        try {
          const result = parseCaptureOutput(stdout);
          if (!result.ok || typeof result.text !== "string" || !result.text.trim()) {
            throw new Error(typeof result.error === "string" && result.error.trim()
              ? result.error.trim()
              : "No Codex Dictation transcript was captured");
          }
          resolve({
            answer: result.text.trim(),
            source: typeof result.source === "string" ? result.source : "unknown",
            promptAudio: typeof result.promptAudio === "string" ? result.promptAudio : "unknown",
            manualStop: result.manualStop === true,
            transcriptionLatencyMs: Number.isFinite(result.transcriptionLatencyMs)
              ? result.transcriptionLatencyMs
              : null,
            totalElapsedMs: Number.isFinite(result.totalElapsedMs) ? result.totalElapsedMs : null,
          });
        } catch (error) {
          const detail = stderr.trim().slice(0, 300);
          const suffix = detail ? ` ${detail}` : code ? ` Helper exit code: ${code}.` : "";
          reject(new Error(`${error instanceof Error ? error.message : "Dictation capture failed"}${suffix}`));
        }
      });
    });
  });
}

function serializedCapture(prompt) {
  const run = captureTail.then(() => launchCapture(prompt), () => launchCapture(prompt));
  captureTail = run.then(() => undefined, () => undefined);
  return run;
}

async function callTool(params) {
  if (params?.name !== TOOL_NAME) throw new Error(`Unknown tool: ${String(params?.name)}`);
  const args = params.arguments;
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("Tool arguments must be an object");
  }
  const prompt = buildPrompt(args);
  try {
    const capture = await serializedCapture(prompt);
    return {
      content: [{ type: "text", text: `Voice answer captured: ${capture.answer}` }],
      structuredContent: { ok: true, ...capture },
      isError: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Dictation capture failed";
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
      const protocolVersion = typeof message.params?.protocolVersion === "string"
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
      respond(message.id, await callTool(message.params));
      return;
    }
    respondError(message.id, -32601, `Method not found: ${message.method}`);
  } catch (error) {
    respondError(message.id, -32602, error instanceof Error ? error.message : "Invalid request");
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
  if (message && "id" in message && "method" in message) void handleRequest(message);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  let newlineIndex = inputBuffer.indexOf("\n");
  while (newlineIndex >= 0) {
    acceptLine(inputBuffer.slice(0, newlineIndex).replace(/\r$/, ""));
    inputBuffer = inputBuffer.slice(newlineIndex + 1);
    newlineIndex = inputBuffer.indexOf("\n");
  }
});
process.stdin.on("end", () => {
  if (inputBuffer.trim()) acceptLine(inputBuffer);
});
