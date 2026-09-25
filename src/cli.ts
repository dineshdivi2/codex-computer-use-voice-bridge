import { resolve } from "node:path";
import { AppServerClient } from "./app-server-client.ts";
import { SanitizedAuditLog } from "./audit-log.ts";
import {
  CodexDictationInterventionAdapter,
  TerminalFallbackChannel,
  VoiceInterventionAdapter,
} from "./channels.ts";
import { InterventionCoordinator } from "./intervention-coordinator.ts";
import { humanInterventionMcpConfig } from "./mcp-config.ts";
import { ThreadAndTurnManager } from "./thread-turn-manager.ts";

interface CliOptions {
  prompt: string;
  cwd: string;
  model?: string;
  resume?: string;
  noVoice: boolean;
  voiceMode: "dictation" | "local";
  codexBinary?: string;
  voiceScript?: string;
  dictationScript?: string;
  dictationHotkey: string;
  dictationTimeoutMs: number;
  dictationAutoStopSeconds: number;
  auditPath: string;
  noMcp: boolean;
  mcpNode?: string;
  mcpServer?: string;
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function numericOption(
  args: string[],
  flag: string,
  fallback: number,
  minimum: number,
): number {
  const raw = valueAfter(args, flag);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum) {
    throw new Error(`${flag} must be a number greater than or equal to ${minimum}`);
  }
  return value;
}

function parseArgs(args: string[]): CliOptions {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage:
  node --experimental-strip-types src/cli.ts --prompt "Task" [options]

Options:
  --cwd <path>          Codex working directory (default: current directory)
  --model <id>          Optional exact Codex model id
  --resume <thread-id>  Resume an existing Codex thread
  --no-voice            Use terminal intervention only
  --voice-mode <mode>   dictation (default) or local (legacy faster-whisper bridge)
  --codex-bin <path>    Explicit codex executable
  --voice-script <path> Existing ask-native-voice.ps1 launcher for local mode
  --dictation-script <path>  Codex Dictation WinForms launcher
  --dictation-hotkey <keys>  SendKeys expression (default: %n for Alt+N)
  --dictation-timeout-seconds <n>  Manual response timeout (default: 120)
  --dictation-auto-stop-seconds <n>  Optional automatic stop; 0 keeps manual Alt-stop
  --audit <path>        Sanitized JSONL audit path
  --no-mcp              Do not inject the Default-mode human intervention MCP server
  --mcp-node <path>     Node 24+ executable used to launch the MCP server
  --mcp-server <path>   Human intervention MCP server TypeScript entrypoint
`);
    process.exit(0);
  }
  const prompt = valueAfter(args, "--prompt");
  if (!prompt) throw new Error("--prompt is required");
  const cwd = resolve(valueAfter(args, "--cwd") ?? process.cwd());
  const voiceMode = valueAfter(args, "--voice-mode") ?? "dictation";
  if (voiceMode !== "dictation" && voiceMode !== "local") {
    throw new Error("--voice-mode must be dictation or local");
  }
  return {
    prompt,
    cwd,
    model: valueAfter(args, "--model"),
    resume: valueAfter(args, "--resume"),
    noVoice: args.includes("--no-voice"),
    voiceMode,
    codexBinary: valueAfter(args, "--codex-bin"),
    voiceScript: valueAfter(args, "--voice-script"),
    dictationScript: valueAfter(args, "--dictation-script"),
    dictationHotkey: valueAfter(args, "--dictation-hotkey") ?? "%n",
    dictationTimeoutMs:
      numericOption(args, "--dictation-timeout-seconds", 120, 15) * 1_000,
    dictationAutoStopSeconds: numericOption(
      args,
      "--dictation-auto-stop-seconds",
      0,
      0,
    ),
    auditPath: resolve(valueAfter(args, "--audit") ?? "logs/interventions.jsonl"),
    noMcp: args.includes("--no-mcp"),
    mcpNode: valueAfter(args, "--mcp-node"),
    mcpServer: valueAfter(args, "--mcp-server"),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const client = AppServerClient.spawn({
    codexBinary: options.codexBinary,
    cwd: options.cwd,
  });
  const terminal = new TerminalFallbackChannel();
  const voice = options.noVoice
    ? terminal
    : options.voiceMode === "local"
      ? new VoiceInterventionAdapter({ launcherScript: options.voiceScript })
      : new CodexDictationInterventionAdapter({
          launcherScript: options.dictationScript,
          hotkey: options.dictationHotkey,
          timeoutMs: options.dictationTimeoutMs,
          autoStopSeconds: options.dictationAutoStopSeconds,
        });
  const coordinator = new InterventionCoordinator({
    responder: client,
    voice,
    fallback: terminal,
    audit: new SanitizedAuditLog(options.auditPath),
  });
  coordinator.attach(client);
  const manager = new ThreadAndTurnManager(client);

  client.on("stderr", (text) => process.stderr.write(text));
  client.on("interventionError", (error) => console.error("Intervention error:", error));
  client.on("protocolError", (error) => console.error("Protocol error:", error));
  client.on("notification", (notification) => {
    if (notification.method === "item/agentMessage/delta") {
      process.stdout.write(notification.params.delta);
    }
  });

  const completion = new Promise<void>((resolveCompletion, rejectCompletion) => {
    client.on("notification", (notification) => {
      if (notification.method === "turn/completed") {
        console.log(`\n[turn ${notification.params.turn.status}]`);
        resolveCompletion();
      }
    });
    client.once("disconnected", rejectCompletion);
  });

  let stopping = false;
  process.on("SIGINT", () => {
    if (stopping) return;
    stopping = true;
    void manager.cancel().finally(() => client.stop());
  });

  try {
    await client.initialize({ experimentalApi: true });
    if (options.resume) {
      await manager.resumeThread(options.resume, options.cwd);
    } else {
      await manager.startThread({
        cwd: options.cwd,
        model: options.model,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: "workspace-write",
        config: options.noMcp
          ? undefined
          : humanInterventionMcpConfig({
              nodeBinary: options.mcpNode,
              serverScript: options.mcpServer,
            }),
      });
    }
    await manager.startTurn(options.prompt, options.model ? { model: options.model } : {});
    await completion;
  } finally {
    await client.stop();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
