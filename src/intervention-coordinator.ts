import type { ServerNotification } from "../schemas/typescript/ServerNotification.ts";
import type { ServerRequest } from "../schemas/typescript/ServerRequest.ts";
import type { RequestId } from "../schemas/typescript/RequestId.ts";
import { AppServerClient } from "./app-server-client.ts";
import type { AuditSink } from "./audit-log.ts";
import { auditFromPending } from "./audit-log.ts";
import type { InterventionChannel } from "./channels.ts";
import {
  correlationFromRequest,
  isSupportedServerRequest,
  type SanitizedPrompt,
  type SupportedServerRequest,
} from "./domain.ts";
import { InterventionPolicy } from "./intervention-policy.ts";
import { PendingRequestRegistry } from "./pending-request-registry.ts";
import { PromptSanitizer } from "./prompt-sanitizer.ts";
import { ResponseInterpreter } from "./response-interpreter.ts";

export interface ServerResponder {
  respond(requestId: RequestId, result: unknown): void;
  respondError(requestId: RequestId, code: number, message: string): void;
}

export interface CoordinatorOptions {
  responder: ServerResponder;
  voice: InterventionChannel;
  fallback: InterventionChannel;
  audit: AuditSink;
  registry?: PendingRequestRegistry;
  policy?: InterventionPolicy;
  sanitizer?: PromptSanitizer;
  interpreter?: ResponseInterpreter;
  responseTimeoutMs?: number;
  channelTimeoutMs?: number;
  onProgress?: (
    event: "waiting" | "answer-sent" | "cleared" | "failed",
    requestId: RequestId,
  ) => void;
}

export class InterventionCoordinator {
  readonly registry: PendingRequestRegistry;
  readonly #responder: ServerResponder;
  readonly #voice: InterventionChannel;
  readonly #fallback: InterventionChannel;
  readonly #audit: AuditSink;
  readonly #policy: InterventionPolicy;
  readonly #sanitizer: PromptSanitizer;
  readonly #interpreter: ResponseInterpreter;
  readonly #captures = new Map<string, AbortController>();
  readonly #responseTimeoutMs: number;
  readonly #channelTimeoutMs: number;
  readonly #onProgress?: CoordinatorOptions["onProgress"];

  constructor(options: CoordinatorOptions) {
    this.#responder = options.responder;
    this.#voice = options.voice;
    this.#fallback = options.fallback;
    this.#audit = options.audit;
    this.registry = options.registry ?? new PendingRequestRegistry();
    this.#policy = options.policy ?? new InterventionPolicy();
    this.#sanitizer = options.sanitizer ?? new PromptSanitizer();
    this.#interpreter = options.interpreter ?? new ResponseInterpreter();
    this.#responseTimeoutMs = options.responseTimeoutMs ?? 180_000;
    this.#channelTimeoutMs = options.channelTimeoutMs ?? 120_000;
    this.#onProgress = options.onProgress;
  }

  attach(client: AppServerClient): void {
    client.on("serverRequest", (request) => {
      void this.handleServerRequest(request).catch((error) => {
        client.emit("interventionError", error);
      });
    });
    client.on("notification", (notification) => {
      void this.handleNotification(notification).catch((error) => {
        client.emit("interventionError", error);
      });
    });
    client.on("disconnected", () => {
      void this.handleDisconnect().catch((error) => {
        client.emit("interventionError", error);
      });
    });
  }

  async handleServerRequest(request: ServerRequest): Promise<void> {
    if (!isSupportedServerRequest(request)) {
      this.#responder.respondError(
        request.id,
        -32601,
        `Harness does not implement server request ${request.method}`,
      );
      await this.#audit.write({
        event: "unsupported-server-request",
        requestId: request.id,
        method: request.method,
        state: "FAIL_CLOSED",
      });
      return;
    }

    const expiresAtMs = this.#expiry(request);
    let pending = this.registry.register(request, expiresAtMs);
    const captureKey = `${typeof request.id}:${request.id}`;
    const cancellation = new AbortController();
    this.#captures.set(captureKey, cancellation);
    const remainingMs = Math.max(
      1,
      Math.min(this.#responseTimeoutMs, (expiresAtMs ?? Infinity) - Date.now()),
    );
    const signal = AbortSignal.any([
      cancellation.signal,
      AbortSignal.timeout(remainingMs),
    ]);
    let responseAttempted = false;

    try {
      await this.#audit.write(auditFromPending("registered", pending));
      signal.throwIfAborted();
      this.registry.assertRespondable(correlationFromRequest(request));
      const policy = this.#policy.evaluate(request);
      pending = this.registry.transition(request.id, "POLICY_EVALUATED");
      const prompt = this.#sanitizer.sanitize(request);
      prompt.taskTitle =
        request.method === "item/tool/requestUserInput"
          ? `Codex - ${request.params.questions[0]?.header ?? "Question"}`
          : `Codex - ${request.method === "mcpServer/elicitation/request" ? request.params.serverName : "Permission request"}`;
      if (request.method === "item/tool/requestUserInput") {
        prompt.choices = request.params.questions[0]?.options?.map(
          (option) => option.label,
        );
      }
      let activePrompt: SanitizedPrompt = prompt;
      pending = this.registry.transition(request.id, "PROMPT_SANITIZED");

      if (policy.channel === "failClosed") {
        throw new Error(policy.reason);
      }

      let channel =
        policy.channel === "terminalOnly" ? this.#fallback : this.#voice;
      if (policy.channel === "terminalOnly") {
        pending = this.registry.transition(request.id, "FALLBACK_REQUIRED");
      }

      let voiceAttempts = 0;
      let fallbackUsed = policy.channel === "terminalOnly";
      for (;;) {
        signal.throwIfAborted();
        pending = this.registry.transition(request.id, "USER_NOTIFIED", {
          channel: fallbackUsed ? "terminal" : "voice",
        });
        pending = this.registry.transition(request.id, "CAPTURING_RESPONSE");
        this.#onProgress?.("waiting", request.id);
        const answer = await this.#ask(
          channel,
          activePrompt,
          Math.min(this.#channelTimeoutMs, remainingMs),
          signal,
        );
        this.registry.assertRespondable(correlationFromRequest(request));
        signal.throwIfAborted();

        if (answer.errorCode === "cancelled") {
          if (request.method === "mcpServer/elicitation/request") {
            responseAttempted = true;
            this.#responder.respond(request.id, {
              action: "cancel",
              content: null,
              _meta: null,
            });
            pending = this.registry.transition(
              request.id,
              "VALIDATING_RESPONSE",
            );
            pending = this.registry.transition(request.id, "CANCELLED");
            pending = this.registry.transition(
              request.id,
              "RESPONDING_TO_APP_SERVER",
            );
            pending = this.registry.transition(
              request.id,
              "AWAITING_SERVER_RESOLUTION",
            );
            await this.#audit.write(auditFromPending("response-sent", pending));
            return;
          }
          throw new Error("Human cancelled the question");
        }

        if (!answer.ok) {
          if (!fallbackUsed) {
            pending = this.registry.transition(request.id, "VOICE_TIMEOUT");
            pending = this.registry.transition(request.id, "FALLBACK_REQUIRED");
            channel = this.#fallback;
            fallbackUsed = true;
            await this.#audit.write({
              ...auditFromPending("voice-fallback", pending),
              detail: "Voice channel returned no usable answer",
            });
            continue;
          }
          throw new Error(
            answer.error ?? "Human intervention channel returned no answer",
          );
        }

        pending = this.registry.transition(request.id, "VALIDATING_RESPONSE", {
          channel: answer.channel,
        });
        const interpretation = this.#interpreter.interpret(
          request,
          answer.text,
        );
        if (interpretation.kind === "ambiguous") {
          pending = this.registry.transition(request.id, "AMBIGUOUS_RESPONSE");
          await this.#audit.write({
            ...auditFromPending("ambiguous-response", pending),
            detail: interpretation.reason,
          });
          activePrompt = {
            taskTitle: prompt.taskTitle,
            choices: prompt.choices,
            spoken: interpretation.clarification,
            terminal: `${prompt.terminal}\n\n${interpretation.clarification}`,
            sensitivity: prompt.sensitivity,
          };
          if (!fallbackUsed && voiceAttempts + 1 < policy.maxVoiceAttempts) {
            voiceAttempts += 1;
            channel = this.#voice;
            continue;
          }
          if (!fallbackUsed) {
            pending = this.registry.transition(request.id, "FALLBACK_REQUIRED");
            channel = this.#fallback;
            fallbackUsed = true;
            continue;
          }
          throw new Error(interpretation.reason);
        }

        if (interpretation.terminalState) {
          pending = this.registry.transition(
            request.id,
            interpretation.terminalState,
            {
              decision: interpretation.decision,
            },
          );
        }
        pending = this.registry.transition(
          request.id,
          "RESPONDING_TO_APP_SERVER",
          {
            decision: interpretation.decision,
          },
        );
        this.registry.assertRespondable(correlationFromRequest(request));
        responseAttempted = true;
        this.#responder.respond(request.id, interpretation.response);
        pending = this.registry.transition(
          request.id,
          "AWAITING_SERVER_RESOLUTION",
        );
        await this.#audit.write(auditFromPending("response-sent", pending));
        this.#onProgress?.("answer-sent", request.id);
        return;
      }
    } catch (error) {
      if (responseAttempted)
        throw new Error(
          "The response was attempted; post-response handling failed",
        );
      const current = this.registry.get(request.id);
      if (
        current &&
        ![
          "RESOLVED",
          "EXPIRED",
          "TURN_COMPLETED_BEFORE_RESPONSE",
          "APP_SERVER_DISCONNECTED",
        ].includes(current.state)
      ) {
        pending = this.registry.forceTerminal(request.id, "FAIL_CLOSED");
        this.#responder.respondError(
          request.id,
          -32002,
          "Human intervention could not be resolved safely",
        );
        await this.#audit.write({
          ...auditFromPending("fail-closed", pending),
          detail: signal.aborted
            ? "Intervention cancelled or timed out"
            : "Intervention could not be completed",
        });
        this.#onProgress?.("failed", request.id);
      }
    } finally {
      this.#captures.delete(captureKey);
    }
  }

  async handleNotification(notification: ServerNotification): Promise<void> {
    if (notification.method === "serverRequest/resolved") {
      const pending = this.registry.resolveFromServer(
        notification.params.threadId,
        notification.params.requestId,
      );
      if (pending) {
        this.#captures
          .get(
            `${typeof notification.params.requestId}:${notification.params.requestId}`,
          )
          ?.abort();
        await this.#audit.write(auditFromPending("resolved", pending));
        this.#onProgress?.("cleared", notification.params.requestId);
      }
      return;
    }
    if (notification.method === "turn/completed") {
      const expired = this.registry.completeTurn(
        notification.params.threadId,
        notification.params.turn.id,
      );
      for (const pending of expired) {
        this.#captures
          .get(`${typeof pending.requestId}:${pending.requestId}`)
          ?.abort();
        await this.#audit.write(
          auditFromPending("turn-completed-before-response", pending),
        );
      }
    }
  }

  async handleDisconnect(): Promise<void> {
    for (const pending of this.registry.disconnectAll()) {
      this.#captures
        .get(`${typeof pending.requestId}:${pending.requestId}`)
        ?.abort();
      await this.#audit.write(
        auditFromPending("app-server-disconnected", pending),
      );
    }
  }

  async #ask(
    channel: InterventionChannel,
    prompt: SanitizedPrompt,
    timeoutMs: number,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    // Stop waiting even if an older/custom channel ignores the cancellation signal.
    return new Promise<Awaited<ReturnType<InterventionChannel["ask"]>>>(
      (resolve, reject) => {
        const abort = () => reject(new Error("Intervention cancelled"));
        signal.addEventListener("abort", abort, { once: true });
        Promise.resolve()
          .then(() => {
            signal.throwIfAborted();
            return channel.ask(prompt, timeoutMs, signal);
          })
          .then(resolve, reject)
          .finally(() => signal.removeEventListener("abort", abort));
      },
    );
  }

  #expiry(request: SupportedServerRequest): number | null {
    if (request.method !== "item/tool/requestUserInput") return null;
    const duration = request.params.autoResolutionMs;
    return typeof duration === "number" && Number.isFinite(duration)
      ? Date.now() + Math.max(0, duration)
      : null;
  }
}
