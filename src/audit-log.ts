import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { PendingIntervention } from "./domain.ts";

export interface AuditEvent {
  event: string;
  requestId?: string | number;
  threadId?: string;
  turnId?: string | null;
  itemId?: string | null;
  method?: string;
  state?: string;
  channel?: string;
  decision?: string;
  detail?: string;
  timestamp?: string;
}

export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
}

export class SanitizedAuditLog implements AuditSink {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  async write(event: AuditEvent): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const safe: AuditEvent = {
      timestamp: new Date().toISOString(),
      ...event,
    };
    await appendFile(this.#path, `${JSON.stringify(safe)}\n`, "utf8");
  }
}

export class MemoryAuditLog implements AuditSink {
  readonly events: AuditEvent[] = [];

  async write(event: AuditEvent): Promise<void> {
    this.events.push({ timestamp: new Date().toISOString(), ...structuredClone(event) });
  }
}

export function auditFromPending(event: string, pending: PendingIntervention): AuditEvent {
  return {
    event,
    requestId: pending.requestId,
    threadId: pending.threadId,
    turnId: pending.turnId,
    itemId: pending.itemId,
    method: pending.method,
    state: pending.state,
    channel: pending.channel,
    decision: pending.decision,
  };
}
