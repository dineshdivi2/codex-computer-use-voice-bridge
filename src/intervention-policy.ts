import type { SupportedServerRequest } from "./domain.ts";

export type ChannelPolicy = "voiceThenTerminal" | "terminalOnly" | "failClosed";

export interface PolicyDecision {
  channel: ChannelPolicy;
  reason: string;
  maxVoiceAttempts: number;
}

function containsSensitiveMarker(value: unknown): boolean {
  if (typeof value === "string") {
    return /password|secret|token|credential|private key|otp|one[- ]time code/i.test(value);
  }
  if (Array.isArray(value)) return value.some(containsSensitiveMarker);
  if (value && typeof value === "object") {
    return Object.entries(value).some(
      ([key, nested]) => containsSensitiveMarker(key) || containsSensitiveMarker(nested),
    );
  }
  return false;
}

export class InterventionPolicy {
  evaluate(request: SupportedServerRequest): PolicyDecision {
    if (request.method === "item/tool/requestUserInput") {
      if (request.params.questions.some((question) => question.isSecret)) {
        return {
          channel: "terminalOnly",
          reason: "Secret answers must never be spoken or transcribed",
          maxVoiceAttempts: 0,
        };
      }
      return {
        channel: "voiceThenTerminal",
        reason: "Codex requested bounded human input",
        maxVoiceAttempts: 2,
      };
    }

    if (request.method === "mcpServer/elicitation/request") {
      if (request.params.mode === "url") {
        return {
          channel: "terminalOnly",
          reason: "URL and authentication handoffs require a visual channel",
          maxVoiceAttempts: 0,
        };
      }
      if (containsSensitiveMarker(request.params.requestedSchema)) {
        return {
          channel: "terminalOnly",
          reason: "Sensitive form fields require a non-voice channel",
          maxVoiceAttempts: 0,
        };
      }
      return {
        channel: "voiceThenTerminal",
        reason: "Simple MCP form elicitation can use the local voice channel",
        maxVoiceAttempts: 2,
      };
    }

    return {
      channel: "voiceThenTerminal",
      reason: "Explicit Codex approval request with exact decision vocabulary",
      maxVoiceAttempts: 2,
    };
  }
}
