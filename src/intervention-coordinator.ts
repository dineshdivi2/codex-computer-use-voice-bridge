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

  constructor(options: CoordinatorOptions) {
    this.#responder = options.responder;
    this.#voice = options.voice;
    this.#fallback = options.fallback;
    this.#audit = options.audit;
    this.registry = options.registry ?? new PendingRequestRegistry();
    this.#policy = options.policy ?? new InterventionPolicy();
    this.#sanitizer = options.sanitizer ?? new PromptSanitizer();
    this.#interpreter = options.interpreter ?? new ResponseInterpreter();
  }

  attach(client: AppServerClient): void {
    client.on("serverRequest", (request) => {
      void this.handleServerRequest(request).catch((error) => {
        client.emit("interventionError", error);
      });
    });
    client.on("notification", (notification) => {
      void this.handleNotification(notification);
    });
    client.on("disconnected", () => {
      void this.handleDisconnect();
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
    await this.#audit.write(auditFromPending("registered", pending));

    try {
      const policy = this.#policy.evaluate(request);
      pending = this.registry.transition(request.id, "POLICY_EVALUATED");
      const prompt = this.#sanitizer.sanitize(request);
      let activePrompt: SanitizedPrompt = prompt;
      pending = this.registry.transition(request.id, "PROMPT_SANITIZED");

      if (policy.channel === "failClosed") {
        throw new Error(policy.reason);
      }

      let channel = policy.channel === "terminalOnly" ? this.#fallback : this.#voice;
      if (policy.channel === "terminalOnly") {
        pending = this.registry.transition(request.id, "FALLBACK_REQUIRED");
      }

      let voiceAttempts = 0;
      let fallbackUsed = policy.channel === "terminalOnly";
      for (;;) {
        pending = this.registry.transition(request.id, "USER_NOTIFIED", {
          channel: fallbackUsed ? "terminal" : "voice",
        });
        pending = this.registry.transition(request.id, "CAPTURING_RESPONSE");
        const answer = await channel.ask(activePrompt);
        this.registry.assertRespondable(correlationFromRequest(request));

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
          throw new Error(answer.error ?? "Human intervention channel returned no answer");
        }

        pending = this.registry.transition(request.id, "VALIDATING_RESPONSE", {
          channel: answer.channel,
        });
        const interpretation = this.#interpreter.interpret(request, answer.text);
        if (interpretation.kind === "ambiguous") {
          pending = this.registry.transition(request.id, "AMBIGUOUS_RESPONSE");
          await this.#audit.write({
            ...auditFromPending("ambiguous-response", pending),
            detail: interpretation.reason,
          });
          activePrompt = {
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
          pending = this.registry.transition(request.id, interpretation.terminalState, {
            decision: interpretation.decision,
          });
        }
        pending = this.registry.transition(request.id, "RESPONDING_TO_APP_SERVER", {
          decision: interpretation.decision,
        });
        this.registry.assertRespondable(correlationFromRequest(request));
        this.#responder.respond(request.id, interpretation.response);
        pending = this.registry.transition(request.id, "AWAITING_SERVER_RESOLUTION");
        await this.#audit.write(auditFromPending("response-sent", pending));
        return;
      }
    } catch (error) {
      const current = this.registry.get(request.id);
      if (current && ![
        "RESOLVED",
        "EXPIRED",
        "TURN_COMPLETED_BEFORE_RESPONSE",
        "APP_SERVER_DISCONNECTED",
      ].includes(current.state)) {
        pending = this.registry.forceTerminal(request.id, "FAIL_CLOSED");
        this.#responder.respondError(
          request.id,
          -32002,
          "Human intervention could not be resolved safely",
        );
        await this.#audit.write({
          ...auditFromPending("fail-closed", pending),
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async handleNotification(notification: ServerNotification): Promise<void> {
    if (notification.method === "serverRequest/resolved") {
      const pending = this.registry.resolveFromServer(
        notification.params.threadId,
        notification.params.requestId,
      );
      if (pending) await this.#audit.write(auditFromPending("resolved", pending));
      return;
    }
    if (notification.method === "turn/completed") {
      const expired = this.registry.completeTurn(
        notification.params.threadId,
        notification.params.turn.id,
      );
      for (const pending of expired) {
        await this.#audit.write(auditFromPending("turn-completed-before-response", pending));
      }
    }
  }

  async handleDisconnect(): Promise<void> {
    for (const pending of this.registry.disconnectAll()) {
      await this.#audit.write(auditFromPending("app-server-disconnected", pending));
    }
  }

  #expiry(request: SupportedServerRequest): number | null {
    if (request.method !== "item/tool/requestUserInput") return null;
    return request.params.autoResolutionMs === null
      ? null
      : Date.now() + request.params.autoResolutionMs;
  }
}
