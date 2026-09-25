import type { CommandExecutionRequestApprovalResponse } from "../schemas/typescript/v2/CommandExecutionRequestApprovalResponse.ts";
import type { FileChangeRequestApprovalResponse } from "../schemas/typescript/v2/FileChangeRequestApprovalResponse.ts";
import type { McpServerElicitationRequestResponse } from "../schemas/typescript/v2/McpServerElicitationRequestResponse.ts";
import type { PermissionsRequestApprovalResponse } from "../schemas/typescript/v2/PermissionsRequestApprovalResponse.ts";
import type { ToolRequestUserInputResponse } from "../schemas/typescript/v2/ToolRequestUserInputResponse.ts";
import type { Interpretation, SupportedServerRequest } from "./domain.ts";

function normalize(text: string): string {
  return text
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeBoundedChoice(text: string): string {
  const value = normalize(text);
  const tokens = value.split(" ").filter(Boolean);
  for (let width = 1; width <= Math.floor(tokens.length / 2); width += 1) {
    if (tokens.length % width !== 0) continue;
    const phrase = tokens.slice(0, width).join(" ");
    let repeated = true;
    for (let index = width; index < tokens.length; index += width) {
      if (tokens.slice(index, index + width).join(" ") !== phrase) {
        repeated = false;
        break;
      }
    }
    if (repeated) return phrase;
  }
  return value;
}

type ApprovalMeaning = "accept" | "acceptForSession" | "decline" | "cancel";

function approvalMeaning(text: string): ApprovalMeaning | null {
  const value = normalizeBoundedChoice(text);
  if (
    [
      "approve",
      "approve once",
      "approve once for this codex request",
      "approve once for this cortex request",
      "apro once for this codex request",
      "apro once for this cortex request",
      "accept",
      "accept once",
      "allow once",
    ].includes(value)
  ) {
    return "accept";
  }
  if (
    [
      "approve for session",
      "approve this session",
      "accept for session",
      "allow for session",
      "allow this session",
    ].includes(value)
  ) {
    return "acceptForSession";
  }
  if (["decline", "reject", "do not approve", "deny"].includes(value)) return "decline";
  if (["cancel", "stop", "stop the turn"].includes(value)) return "cancel";
  return null;
}

function approvalAmbiguous(): Interpretation {
  return {
    kind: "ambiguous",
    reason: "Approval answer did not match the exact decision vocabulary",
    clarification:
      "Please say approve once, approve for session, decline, or cancel.",
  };
}

function interpretSimpleForm(request: Extract<SupportedServerRequest, { method: "mcpServer/elicitation/request" }>, text: string): Interpretation {
  if (request.params.mode === "url") {
    return {
      kind: "ambiguous",
      reason: "URL elicitation cannot be resolved by voice",
      clarification: "Complete or cancel this request in the visual fallback.",
    };
  }
  const schema = request.params.requestedSchema as unknown as Record<string, unknown>;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const keys = properties ? Object.keys(properties) : [];
  if (keys.length !== 1) {
    return {
      kind: "ambiguous",
      reason: "Voice MVP supports only one-field MCP forms",
      clarification: "Please answer this structured form in the terminal fallback.",
    };
  }
  const key = keys[0];
  const property = properties![key];
  let value: string | boolean = text.trim();
  if (Array.isArray(property.enum)) {
    let match = property.enum.find(
      (candidate) =>
        typeof candidate === "string" && normalize(candidate) === normalizeBoundedChoice(text),
    );
    if (key === "decision" && match === undefined) {
      const meaning = approvalMeaning(text);
      const canonical = meaning === "accept"
        ? "approve once"
        : meaning === "acceptForSession"
          ? "approve for session"
          : meaning;
      match = property.enum.find(
        (candidate) => typeof candidate === "string" && normalize(candidate) === normalize(canonical ?? ""),
      );
    }
    if (match === undefined) {
      return {
        kind: "ambiguous",
        reason: "Answer did not match an allowed MCP form value",
        clarification: `Please choose: ${property.enum.join(", ")}.`,
      };
    }
    value = String(match);
  } else if (property.type === "boolean") {
    const normalized = normalizeBoundedChoice(text);
    if (["yes", "true"].includes(normalized)) value = true;
    else if (["no", "false"].includes(normalized)) value = false;
    else {
      return {
        kind: "ambiguous",
        reason: "Boolean MCP field requires yes or no",
        clarification: "Please say yes or no.",
      };
    }
  } else if (property.type !== "string") {
    return {
      kind: "ambiguous",
      reason: "Voice MVP supports string, enum, and boolean MCP fields",
      clarification: "Please answer this form in the terminal fallback.",
    };
  }
  const response: McpServerElicitationRequestResponse = {
    action: "accept",
    content: { [key]: value },
    _meta: null,
  };
  return { kind: "valid", response, decision: "mcp-form-accepted" };
}

export class ResponseInterpreter {
  interpret(request: SupportedServerRequest, text: string): Interpretation {
    if (!text.trim()) {
      return {
        kind: "ambiguous",
        reason: "Empty response",
        clarification: "No answer was captured. Please answer again.",
      };
    }

    if (request.method === "item/commandExecution/requestApproval") {
      const decision = approvalMeaning(text);
      if (!decision) return approvalAmbiguous();
      const response: CommandExecutionRequestApprovalResponse = { decision };
      return {
        kind: "valid",
        response,
        decision,
        terminalState: decision === "decline" ? "DECLINED" : decision === "cancel" ? "CANCELLED" : undefined,
      };
    }

    if (request.method === "item/fileChange/requestApproval") {
      const decision = approvalMeaning(text);
      if (!decision) return approvalAmbiguous();
      const response: FileChangeRequestApprovalResponse = { decision };
      return {
        kind: "valid",
        response,
        decision,
        terminalState: decision === "decline" ? "DECLINED" : decision === "cancel" ? "CANCELLED" : undefined,
      };
    }

    if (request.method === "item/permissions/requestApproval") {
      const decision = approvalMeaning(text);
      if (!decision) return approvalAmbiguous();
      const granted = decision === "accept" || decision === "acceptForSession"
        ? {
            ...(request.params.permissions.network
              ? { network: request.params.permissions.network }
              : {}),
            ...(request.params.permissions.fileSystem
              ? { fileSystem: request.params.permissions.fileSystem }
              : {}),
          }
        : {};
      const response: PermissionsRequestApprovalResponse = {
        permissions: granted,
        scope: decision === "acceptForSession" ? "session" : "turn",
      };
      return {
        kind: "valid",
        response,
        decision,
        terminalState: decision === "decline" ? "DECLINED" : decision === "cancel" ? "CANCELLED" : undefined,
      };
    }

    if (request.method === "item/tool/requestUserInput") {
      if (request.params.questions.length !== 1) {
        return {
          kind: "ambiguous",
          reason: "Voice MVP handles one user-input question at a time",
          clarification: "Please answer the questions in the terminal fallback.",
        };
      }
      const question = request.params.questions[0];
      if (question.isSecret) {
        return {
          kind: "ambiguous",
          reason: "Secret input must not pass through voice transcription",
          clarification: "Please use the secure visual fallback.",
        };
      }
      let answer = text.trim();
      if (question.options) {
        const option = question.options.find(
          (candidate) => normalize(candidate.label) === normalizeBoundedChoice(text),
        );
        if (!option && !question.isOther) {
          return {
            kind: "ambiguous",
            reason: "Answer did not match a listed option",
            clarification: `Please choose: ${question.options.map((item) => item.label).join(", ")}.`,
          };
        }
        if (option) answer = option.label;
      }
      const response: ToolRequestUserInputResponse = {
        answers: { [question.id]: { answers: [answer] } },
      };
      return { kind: "valid", response, decision: "user-input-provided" };
    }

    return interpretSimpleForm(request, text);
  }
}
