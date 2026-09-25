import type { RequestId } from "../schemas/typescript/RequestId.ts";
import type { ServerRequest } from "../schemas/typescript/ServerRequest.ts";

export const SUPPORTED_INTERVENTION_METHODS = [
  "item/tool/requestUserInput",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "mcpServer/elicitation/request",
] as const;

export type SupportedInterventionMethod =
  (typeof SUPPORTED_INTERVENTION_METHODS)[number];

export type SupportedServerRequest = Extract<
  ServerRequest,
  { method: SupportedInterventionMethod }
>;

export type InterventionState =
  | "DETECTED"
  | "REGISTERED"
  | "POLICY_EVALUATED"
  | "PROMPT_SANITIZED"
  | "USER_NOTIFIED"
  | "CAPTURING_RESPONSE"
  | "VALIDATING_RESPONSE"
  | "RESPONDING_TO_APP_SERVER"
  | "AWAITING_SERVER_RESOLUTION"
  | "RESOLVED"
  | "VOICE_TIMEOUT"
  | "FALLBACK_REQUIRED"
  | "AMBIGUOUS_RESPONSE"
  | "DECLINED"
  | "CANCELLED"
  | "EXPIRED"
  | "TURN_COMPLETED_BEFORE_RESPONSE"
  | "APP_SERVER_DISCONNECTED"
  | "FAIL_CLOSED";

export type TerminalInterventionState = Extract<
  InterventionState,
  | "RESOLVED"
  | "DECLINED"
  | "CANCELLED"
  | "EXPIRED"
  | "TURN_COMPLETED_BEFORE_RESPONSE"
  | "APP_SERVER_DISCONNECTED"
  | "FAIL_CLOSED"
>;

export interface Correlation {
  requestId: RequestId;
  threadId: string;
  turnId: string | null;
  itemId: string | null;
}

export interface PendingIntervention extends Correlation {
  method: SupportedInterventionMethod;
  request: SupportedServerRequest;
  state: InterventionState;
  createdAtMs: number;
  expiresAtMs: number | null;
  version: number;
  channel?: "voice" | "terminal";
  decision?: string;
}

export interface SanitizedPrompt {
  spoken: string;
  terminal: string;
  sensitivity: "normal" | "sensitive";
}

export interface ChannelAnswer {
  ok: boolean;
  channel: "voice" | "terminal";
  text: string;
  error?: string;
  elapsedMs?: number;
}

export interface ValidInterpretation {
  kind: "valid";
  response: unknown;
  decision: string;
  terminalState?: "DECLINED" | "CANCELLED";
}

export interface AmbiguousInterpretation {
  kind: "ambiguous";
  reason: string;
  clarification: string;
}

export type Interpretation = ValidInterpretation | AmbiguousInterpretation;

export function requestIdKey(id: RequestId): string {
  return `${typeof id}:${String(id)}`;
}

export function isSupportedServerRequest(
  request: ServerRequest,
): request is SupportedServerRequest {
  return (SUPPORTED_INTERVENTION_METHODS as readonly string[]).includes(
    request.method,
  );
}

export function correlationFromRequest(
  request: SupportedServerRequest,
): Correlation {
  const params = request.params as Record<string, unknown>;
  return {
    requestId: request.id,
    threadId: String(params.threadId),
    turnId:
      typeof params.turnId === "string" ? params.turnId : params.turnId === null ? null : null,
    itemId: typeof params.itemId === "string" ? params.itemId : null,
  };
}
