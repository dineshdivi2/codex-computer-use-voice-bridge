import type { RequestId } from "../schemas/typescript/RequestId.ts";
import type {
  Correlation,
  InterventionState,
  PendingIntervention,
  SupportedServerRequest,
  TerminalInterventionState,
} from "./domain.ts";
import {
  correlationFromRequest,
  requestIdKey,
} from "./domain.ts";

const TERMINAL_STATES = new Set<InterventionState>([
  "RESOLVED",
  "DECLINED",
  "CANCELLED",
  "EXPIRED",
  "TURN_COMPLETED_BEFORE_RESPONSE",
  "APP_SERVER_DISCONNECTED",
  "FAIL_CLOSED",
]);

const ALLOWED_TRANSITIONS: Record<InterventionState, ReadonlySet<InterventionState>> = {
  DETECTED: new Set(["REGISTERED", "FAIL_CLOSED"]),
  REGISTERED: new Set(["POLICY_EVALUATED", "EXPIRED", "APP_SERVER_DISCONNECTED", "FAIL_CLOSED"]),
  POLICY_EVALUATED: new Set(["PROMPT_SANITIZED", "FALLBACK_REQUIRED", "FAIL_CLOSED"]),
  PROMPT_SANITIZED: new Set(["USER_NOTIFIED", "FALLBACK_REQUIRED", "FAIL_CLOSED"]),
  USER_NOTIFIED: new Set(["CAPTURING_RESPONSE", "VOICE_TIMEOUT", "FALLBACK_REQUIRED", "FAIL_CLOSED"]),
  CAPTURING_RESPONSE: new Set([
    "VALIDATING_RESPONSE",
    "VOICE_TIMEOUT",
    "FALLBACK_REQUIRED",
    "TURN_COMPLETED_BEFORE_RESPONSE",
    "APP_SERVER_DISCONNECTED",
    "FAIL_CLOSED",
  ]),
  VALIDATING_RESPONSE: new Set([
    "RESPONDING_TO_APP_SERVER",
    "AMBIGUOUS_RESPONSE",
    "DECLINED",
    "CANCELLED",
    "TURN_COMPLETED_BEFORE_RESPONSE",
    "APP_SERVER_DISCONNECTED",
    "FAIL_CLOSED",
  ]),
  RESPONDING_TO_APP_SERVER: new Set([
    "AWAITING_SERVER_RESOLUTION",
    "APP_SERVER_DISCONNECTED",
    "FAIL_CLOSED",
  ]),
  AWAITING_SERVER_RESOLUTION: new Set([
    "RESOLVED",
    "TURN_COMPLETED_BEFORE_RESPONSE",
    "APP_SERVER_DISCONNECTED",
    "FAIL_CLOSED",
  ]),
  VOICE_TIMEOUT: new Set(["FALLBACK_REQUIRED", "EXPIRED", "FAIL_CLOSED"]),
  FALLBACK_REQUIRED: new Set([
    "USER_NOTIFIED",
    "CAPTURING_RESPONSE",
    "EXPIRED",
    "FAIL_CLOSED",
  ]),
  AMBIGUOUS_RESPONSE: new Set([
    "USER_NOTIFIED",
    "CAPTURING_RESPONSE",
    "FALLBACK_REQUIRED",
    "EXPIRED",
    "FAIL_CLOSED",
  ]),
  RESOLVED: new Set(),
  DECLINED: new Set(["RESPONDING_TO_APP_SERVER", "AWAITING_SERVER_RESOLUTION", "RESOLVED"]),
  CANCELLED: new Set(["RESPONDING_TO_APP_SERVER", "AWAITING_SERVER_RESOLUTION", "RESOLVED"]),
  EXPIRED: new Set(),
  TURN_COMPLETED_BEFORE_RESPONSE: new Set(),
  APP_SERVER_DISCONNECTED: new Set(),
  FAIL_CLOSED: new Set(),
};

export class PendingRequestRegistry {
  readonly #requests = new Map<string, PendingIntervention>();
  readonly #clock: () => number;

  constructor(clock: () => number = Date.now) {
    this.#clock = clock;
  }

  register(request: SupportedServerRequest, expiresAtMs: number | null): PendingIntervention {
    const key = requestIdKey(request.id);
    if (this.#requests.has(key)) {
      throw new Error(`Duplicate server request id ${String(request.id)}`);
    }
    const correlation = correlationFromRequest(request);
    const pending: PendingIntervention = {
      ...correlation,
      method: request.method,
      request,
      state: "REGISTERED",
      createdAtMs: this.#clock(),
      expiresAtMs,
      version: 1,
    };
    this.#requests.set(key, pending);
    return structuredClone(pending);
  }

  get(requestId: RequestId): PendingIntervention | undefined {
    const value = this.#requests.get(requestIdKey(requestId));
    return value ? structuredClone(value) : undefined;
  }

  listActive(): PendingIntervention[] {
    return [...this.#requests.values()]
      .filter((item) => !TERMINAL_STATES.has(item.state))
      .map((item) => structuredClone(item));
  }

  transition(
    requestId: RequestId,
    next: InterventionState,
    patch: Partial<Pick<PendingIntervention, "channel" | "decision">> = {},
  ): PendingIntervention {
    const pending = this.#require(requestId);
    if (!ALLOWED_TRANSITIONS[pending.state].has(next)) {
      throw new Error(`Invalid intervention transition ${pending.state} -> ${next}`);
    }
    pending.state = next;
    pending.version += 1;
    Object.assign(pending, patch);
    return structuredClone(pending);
  }

  assertRespondable(correlation: Correlation, expectedVersion?: number): PendingIntervention {
    const pending = this.#require(correlation.requestId);
    if (TERMINAL_STATES.has(pending.state)) {
      throw new Error(`Request ${String(correlation.requestId)} is already ${pending.state}`);
    }
    if (
      pending.threadId !== correlation.threadId ||
      pending.turnId !== correlation.turnId ||
      pending.itemId !== correlation.itemId
    ) {
      throw new Error(`Correlation mismatch for request ${String(correlation.requestId)}`);
    }
    if (expectedVersion !== undefined && pending.version !== expectedVersion) {
      throw new Error(`Stale intervention version for request ${String(correlation.requestId)}`);
    }
    if (pending.expiresAtMs !== null && this.#clock() >= pending.expiresAtMs) {
      this.forceTerminal(correlation.requestId, "EXPIRED");
      throw new Error(`Request ${String(correlation.requestId)} has expired`);
    }
    return structuredClone(pending);
  }

  resolveFromServer(threadId: string, requestId: RequestId): PendingIntervention | undefined {
    const pending = this.#requests.get(requestIdKey(requestId));
    if (!pending || pending.threadId !== threadId || TERMINAL_STATES.has(pending.state)) {
      return undefined;
    }
    pending.state = "RESOLVED";
    pending.version += 1;
    return structuredClone(pending);
  }

  completeTurn(threadId: string, turnId: string): PendingIntervention[] {
    const changed: PendingIntervention[] = [];
    for (const pending of this.#requests.values()) {
      if (
        pending.threadId === threadId &&
        pending.turnId === turnId &&
        !TERMINAL_STATES.has(pending.state)
      ) {
        pending.state = "TURN_COMPLETED_BEFORE_RESPONSE";
        pending.version += 1;
        changed.push(structuredClone(pending));
      }
    }
    return changed;
  }

  disconnectAll(): PendingIntervention[] {
    const changed: PendingIntervention[] = [];
    for (const pending of this.#requests.values()) {
      if (!TERMINAL_STATES.has(pending.state)) {
        pending.state = "APP_SERVER_DISCONNECTED";
        pending.version += 1;
        changed.push(structuredClone(pending));
      }
    }
    return changed;
  }

  expireDue(): PendingIntervention[] {
    const now = this.#clock();
    const changed: PendingIntervention[] = [];
    for (const pending of this.#requests.values()) {
      if (
        pending.expiresAtMs !== null &&
        now >= pending.expiresAtMs &&
        !TERMINAL_STATES.has(pending.state)
      ) {
        pending.state = "EXPIRED";
        pending.version += 1;
        changed.push(structuredClone(pending));
      }
    }
    return changed;
  }

  forceTerminal(requestId: RequestId, state: TerminalInterventionState): PendingIntervention {
    const pending = this.#require(requestId);
    if (TERMINAL_STATES.has(pending.state)) return structuredClone(pending);
    pending.state = state;
    pending.version += 1;
    return structuredClone(pending);
  }

  #require(requestId: RequestId): PendingIntervention {
    const pending = this.#requests.get(requestIdKey(requestId));
    if (!pending) throw new Error(`Unknown server request id ${String(requestId)}`);
    return pending;
  }
}
