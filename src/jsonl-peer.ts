import { EventEmitter } from "node:events";
import readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { RequestId } from "../schemas/typescript/RequestId.ts";
import { requestIdKey } from "./domain.ts";

type JsonObject = Record<string, unknown>;

interface PendingClientRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class JsonLinePeer extends EventEmitter {
  readonly #input: Readable;
  readonly #output: Writable;
  readonly #pending = new Map<string, PendingClientRequest>();
  readonly #reader: readline.Interface;
  #nextId = 1;
  #closed = false;

  constructor(input: Readable, output: Writable) {
    super();
    this.#input = input;
    this.#output = output;
    this.#reader = readline.createInterface({ input, crlfDelay: Infinity });
    this.#reader.on("line", (line) => this.#onLine(line));
    this.#reader.on("close", () => this.close(new Error("app-server stream closed")));
    this.#input.on("error", (error) => this.close(error));
    this.#output.on("error", (error) => this.close(error));
  }

  request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    if (this.#closed) {
      return Promise.reject(new Error("Cannot send request: peer is closed"));
    }
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestIdKey(id));
        reject(new Error(`Timed out waiting for ${method} response`));
      }, timeoutMs);
      this.#pending.set(requestIdKey(id), { resolve, reject, timer });
      this.#write({ method, id, params });
    });
  }

  notify(method: string, params: unknown = {}): void {
    this.#write({ method, params });
  }

  respond(id: RequestId, result: unknown): void {
    this.#write({ id, result });
  }

  respondError(id: RequestId, code: number, message: string): void {
    this.#write({ id, error: { code, message } });
  }

  close(reason = new Error("JSONL peer closed")): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.#pending.clear();
    this.emit("disconnected", reason);
  }

  #write(message: JsonObject): void {
    if (this.#closed) throw new Error("Cannot write: peer is closed");
    this.#output.write(`${JSON.stringify(message)}\n`);
  }

  #onLine(line: string): void {
    if (!line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.emit("protocolError", new Error(`Invalid JSONL message: ${String(error)}`));
      return;
    }
    if (!isObject(message)) {
      this.emit("protocolError", new Error("App-server message was not an object"));
      return;
    }

    const hasId = typeof message.id === "string" || typeof message.id === "number";
    const hasMethod = typeof message.method === "string";
    if (hasId && hasMethod) {
      this.emit("serverRequest", message);
      return;
    }
    if (hasId) {
      const pending = this.#pending.get(requestIdKey(message.id as RequestId));
      if (!pending) {
        this.emit("orphanResponse", message);
        return;
      }
      this.#pending.delete(requestIdKey(message.id as RequestId));
      clearTimeout(pending.timer);
      if (isObject(message.error)) {
        pending.reject(
          new Error(
            `App-server error ${String(message.error.code)}: ${String(message.error.message)}`,
          ),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (hasMethod) {
      this.emit("notification", message);
      return;
    }
    this.emit("protocolError", new Error("Unrecognized app-server message shape"));
  }
}
