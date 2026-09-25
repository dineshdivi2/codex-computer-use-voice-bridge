import { resolve } from "node:path";
import { AppServerClient } from "../src/app-server-client.ts";

const audioPath = process.argv[2];
if (!audioPath) throw new Error("Usage: test-local-audio.ts <absolute-wav-path>");

const projectRoot = resolve(import.meta.dirname, "..");
const codexBinary = resolve(projectRoot, ".runtime", "codex-0.147.0-alpha.6.5.exe");
const client = AppServerClient.spawn({ codexBinary, cwd: projectRoot });

let output = "";
let completionStatus: unknown = null;
let completionError: unknown = null;
let completionItems: unknown = null;
let stderr = "";
const completed = new Promise<void>((resolveCompleted, rejectCompleted) => {
  client.on("notification", (notification) => {
    if (notification.method === "item/agentMessage/delta") {
      output += notification.params.delta;
    }
    if (notification.method === "turn/completed") {
      completionStatus = notification.params.turn.status;
      completionError = notification.params.turn.error;
      completionItems = notification.params.turn.items;
      resolveCompleted();
    }
  });
  client.on("stderr", (chunk) => {
    stderr += String(chunk);
  });
  client.once("disconnected", rejectCompleted);
});

try {
  await client.initialize({ experimentalApi: true });
  const thread = await client.startThread({
    cwd: projectRoot,
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: "read-only",
    ephemeral: true,
  });
  await client.startTurn({
    threadId: thread.thread.id,
    input: [
      {
        type: "text",
        text: "Transcribe the attached spoken audio exactly. Return only the words spoken.",
        text_elements: [],
      },
      { type: "localAudio", path: resolve(audioPath) },
    ],
  });
  await completed;
  console.log(
    JSON.stringify({
      ok: completionStatus === "completed",
      transcript: output.trim(),
      status: completionStatus,
      error: completionError,
      items: completionItems,
      stderr: stderr.trim(),
    }),
  );
} finally {
  await client.stop();
}
