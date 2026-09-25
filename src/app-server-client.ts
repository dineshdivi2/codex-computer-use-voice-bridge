import { EventEmitter } from "node:events";
import type { ServerNotification } from "../schemas/typescript/ServerNotification.ts";
import type { ServerRequest } from "../schemas/typescript/ServerRequest.ts";
import type { ThreadResumeParams } from "../schemas/typescript/v2/ThreadResumeParams.ts";
import type { ThreadResumeResponse } from "../schemas/typescript/v2/ThreadResumeResponse.ts";
import type { ThreadStartParams } from "../schemas/typescript/v2/ThreadStartParams.ts";
import type { ThreadStartResponse } from "../schemas/typescript/v2/ThreadStartResponse.ts";
import type { TurnInterruptParams } from "../schemas/typescript/v2/TurnInterruptParams.ts";
import type { TurnStartParams } from "../schemas/typescript/v2/TurnStartParams.ts";
import type { TurnStartResponse } from "../schemas/typescript/v2/TurnStartResponse.ts";
import type { TurnSteerParams } from "../schemas/typescript/v2/TurnSteerParams.ts";
import type { TurnSteerResponse } from "../schemas/typescript/v2/TurnSteerResponse.ts";
import type { RequestId } from "../schemas/typescript/RequestId.ts";
import { JsonLinePeer } from "./jsonl-peer.ts";
import { CodexProcessManager, type ProcessManagerOptions } from "./process-manager.ts";

export interface InitializeOptions {
  clientName?: string;
  clientTitle?: string;
  clientVersion?: string;
  experimentalApi?: boolean;
}

export class AppServerClient extends EventEmitter {
  readonly processManager: CodexProcessManager;
  readonly peer: JsonLinePeer;
  #initialized = false;

  private constructor(manager: CodexProcessManager, peer: JsonLinePeer) {
    super();
    this.processManager = manager;
    this.peer = peer;
    peer.on("serverRequest", (message) => this.emit("serverRequest", message as ServerRequest));
    peer.on("notification", (message) => this.emit("notification", message as ServerNotification));
    peer.on("protocolError", (error) => this.emit("protocolError", error));
    peer.on("disconnected", (error) => this.emit("disconnected", error));
    manager.on("stderr", (chunk) => this.emit("stderr", chunk));
    manager.on("exit", (status) => {
      peer.close(new Error(`Codex app-server exited: ${JSON.stringify(status)}`));
      this.emit("exit", status);
    });
  }

  static spawn(options: ProcessManagerOptions = {}): AppServerClient {
    const manager = new CodexProcessManager(options);
    const child = manager.start();
    return new AppServerClient(manager, new JsonLinePeer(child.stdout, child.stdin));
  }

  async initialize(options: InitializeOptions = {}): Promise<unknown> {
    if (this.#initialized) throw new Error("App-server connection already initialized");
    const result = await this.peer.request("initialize", {
      clientInfo: {
        name: options.clientName ?? "codex_human_intervention_harness",
        title: options.clientTitle ?? "Codex Human Intervention Harness",
        version: options.clientVersion ?? "0.1.0",
      },
      capabilities: {
        // Required by the installed generated contract for item/tool/requestUserInput.
        // Dynamic tools remain disabled by design.
        experimentalApi: options.experimentalApi ?? true,
        requestAttestation: false,
        // Standard MCP form elicitation is translated by app-server into
        // mcpServer/elicitation/request. OpenAI-extended forms remain disabled.
        mcpServerOpenaiFormElicitation: false,
      },
    });
    this.peer.notify("initialized", {});
    this.#initialized = true;
    return result;
  }

  async startThread(params: ThreadStartParams): Promise<ThreadStartResponse> {
    return (await this.peer.request("thread/start", params, 60_000)) as ThreadStartResponse;
  }

  async resumeThread(params: ThreadResumeParams): Promise<ThreadResumeResponse> {
    return (await this.peer.request("thread/resume", params, 60_000)) as ThreadResumeResponse;
  }

  async startTurn(params: TurnStartParams): Promise<TurnStartResponse> {
    return (await this.peer.request("turn/start", params, 60_000)) as TurnStartResponse;
  }

  async steerTurn(params: TurnSteerParams): Promise<TurnSteerResponse> {
    return (await this.peer.request("turn/steer", params)) as TurnSteerResponse;
  }

  async interruptTurn(params: TurnInterruptParams): Promise<void> {
    await this.peer.request("turn/interrupt", params);
  }

  respond(requestId: RequestId, result: unknown): void {
    this.peer.respond(requestId, result);
  }

  respondError(requestId: RequestId, code: number, message: string): void {
    this.peer.respondError(requestId, code, message);
  }

  async stop(): Promise<void> {
    await this.processManager.stop();
  }
}
