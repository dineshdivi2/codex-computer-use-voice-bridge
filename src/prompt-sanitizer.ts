import { basename } from "node:path";
import type { SanitizedPrompt, SupportedServerRequest } from "./domain.ts";

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_KEY]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi, "Bearer [REDACTED]"],
  [/(password|secret|token|credential)\s*[:=]\s*\S+/gi, "$1=[REDACTED]"],
  [/\b\d{6}\b/g, "[REDACTED_CODE]"],
];

function redact(text: string): string {
  let result = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result.replace(/\s+/g, " ").trim();
}

function limit(text: string, max = 360): string {
  return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;
}

function safeFolder(cwd: unknown): string {
  if (typeof cwd !== "string" || !cwd) return "the current workspace";
  return `the ${basename(cwd)} workspace`;
}

function terminalSummary(request: SupportedServerRequest): string {
  const params = request.params as Record<string, unknown>;
  const safe = {
    method: request.method,
    threadId: params.threadId,
    turnId: params.turnId ?? null,
    itemId: params.itemId ?? null,
    reason: typeof params.reason === "string" ? redact(params.reason) : null,
    cwd: typeof params.cwd === "string" ? params.cwd : null,
    networkApprovalContext:
      params.networkApprovalContext && typeof params.networkApprovalContext === "object"
        ? params.networkApprovalContext
        : null,
  };
  return JSON.stringify(safe, null, 2);
}

export class PromptSanitizer {
  sanitize(request: SupportedServerRequest): SanitizedPrompt {
    if (request.method === "item/commandExecution/requestApproval") {
      const network = request.params.networkApprovalContext
        ? " managed network access"
        : " command execution";
      return {
        spoken: `Codex requests${network} in ${safeFolder(request.params.cwd)}. Say approve once, approve for session, decline, or cancel.`,
        terminal: terminalSummary(request),
        sensitivity: "sensitive",
      };
    }

    if (request.method === "item/fileChange/requestApproval") {
      return {
        spoken:
          "Codex requests permission to change files. Say approve once, approve for session, decline, or cancel.",
        terminal: terminalSummary(request),
        sensitivity: "sensitive",
      };
    }

    if (request.method === "item/permissions/requestApproval") {
      return {
        spoken: `Codex requests additional permissions in ${safeFolder(request.params.cwd)}. Say approve once, approve for session, decline, or cancel.`,
        terminal: terminalSummary(request),
        sensitivity: "sensitive",
      };
    }

    if (request.method === "item/tool/requestUserInput") {
      const question = request.params.questions[0];
      if (!question) {
        return {
          spoken: "Codex requested input, but supplied no question.",
          terminal: terminalSummary(request),
          sensitivity: "normal",
        };
      }
      if (question.isSecret) {
        return {
          spoken: "Codex needs sensitive information. Please use the secure visual prompt.",
          terminal: `${question.header}: sensitive answer required; value will not be logged.`,
          sensitivity: "sensitive",
        };
      }
      const options = question.options?.map((option) => option.label).join(", ");
      const spoken = options
        ? `${redact(question.question)} Options are: ${redact(options)}.`
        : redact(question.question);
      return {
        spoken: limit(spoken),
        terminal: `${redact(question.header)}: ${limit(redact(question.question), 1_000)}${options ? `\nOptions: ${redact(options)}` : ""}`,
        sensitivity: "normal",
      };
    }

    if (request.params.mode === "url") {
      return {
        spoken: "Codex requires a visual authentication or URL handoff.",
        terminal: `${redact(request.params.message)}\nOpen URL: ${request.params.url}`,
        sensitivity: "sensitive",
      };
    }
    return {
      spoken: limit(redact(request.params.message)),
      terminal: limit(redact(request.params.message), 1_000),
      sensitivity: "normal",
    };
  }
}

export const redactForAudit = redact;
