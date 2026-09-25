import type { ThreadStartParams } from "../schemas/typescript/v2/ThreadStartParams.ts";
import type { TurnStartParams } from "../schemas/typescript/v2/TurnStartParams.ts";
import type { UserInput } from "../schemas/typescript/v2/UserInput.ts";
import { AppServerClient } from "./app-server-client.ts";

export class ThreadAndTurnManager {
  readonly #client: AppServerClient;
  readonly activeItemIds = new Set<string>();
  readonly completedItemIds = new Set<string>();
  activeThreadId: string | null = null;
  activeTurnId: string | null = null;

  constructor(client: AppServerClient) {
    this.#client = client;
    client.on("notification", (notification) => {
      if (notification.method === "turn/started") {
        this.activeThreadId = notification.params.threadId;
        this.activeTurnId = notification.params.turn.id;
        this.activeItemIds.clear();
      } else if (notification.method === "item/started") {
        if (
          notification.params.threadId === this.activeThreadId &&
          notification.params.turnId === this.activeTurnId
        ) {
          this.activeItemIds.add(notification.params.item.id);
        }
      } else if (notification.method === "item/completed") {
        if (
          notification.params.threadId === this.activeThreadId &&
          notification.params.turnId === this.activeTurnId
        ) {
          this.activeItemIds.delete(notification.params.item.id);
          this.completedItemIds.add(notification.params.item.id);
        }
      } else if (notification.method === "turn/completed") {
        if (
          notification.params.threadId === this.activeThreadId &&
          notification.params.turn.id === this.activeTurnId
        ) {
          this.activeTurnId = null;
          this.activeItemIds.clear();
        }
      }
    });
  }

  async startThread(params: ThreadStartParams): Promise<string> {
    const result = await this.#client.startThread(params);
    this.activeThreadId = result.thread.id;
    return result.thread.id;
  }

  async resumeThread(threadId: string, cwd?: string): Promise<string> {
    const result = await this.#client.resumeThread({ threadId, cwd });
    this.activeThreadId = result.thread.id;
    return result.thread.id;
  }

  async startTurn(text: string, overrides: Omit<TurnStartParams, "threadId" | "input"> = {}): Promise<string> {
    if (!this.activeThreadId) throw new Error("No active thread");
    const input: UserInput[] = [{ type: "text", text, text_elements: [] }];
    const result = await this.#client.startTurn({
      threadId: this.activeThreadId,
      input,
      ...overrides,
    });
    this.activeTurnId = result.turn.id;
    return result.turn.id;
  }

  async steer(text: string): Promise<void> {
    if (!this.activeThreadId || !this.activeTurnId) throw new Error("No active turn to steer");
    await this.#client.steerTurn({
      threadId: this.activeThreadId,
      expectedTurnId: this.activeTurnId,
      input: [{ type: "text", text, text_elements: [] }],
    });
  }

  async cancel(): Promise<void> {
    if (!this.activeThreadId || !this.activeTurnId) return;
    await this.#client.interruptTurn({
      threadId: this.activeThreadId,
      turnId: this.activeTurnId,
    });
  }
}
