import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import {
  createCaptureClient,
  parseCaptureOutput,
} from "../plugin/job-form-voice-bridge/mcp/capture.mjs";

test("requires explicit confirmation and exact capture-session identity", () => {
  assert.equal(
    parseCaptureOutput(
      JSON.stringify({
        ok: true,
        text: "unrelated",
        confirmed: true,
        sessionId: "other",
      }),
      "own",
    ).code,
    "session_mismatch",
  );
  assert.equal(
    parseCaptureOutput(
      JSON.stringify({ ok: true, text: "not reviewed", sessionId: "own" }),
      "own",
    ).code,
    "unconfirmed",
  );
  assert.equal(
    parseCaptureOutput(
      `diagnostic\n${JSON.stringify({ ok: true, text: " reviewed ", confirmed: true, sessionId: "own", source: "typed" })}`,
      "own",
    ).text,
    "reviewed",
  );
});

const echo = `process.stdin.setEncoding('utf8'); let input=''; process.stdin.on('data', c=>input+=c); process.stdin.on('end',()=>{const r=JSON.parse(input); console.log(JSON.stringify({ok:true,confirmed:true,text:r.prompt,sessionId:r.sessionId,source:'typed'}));});`;
test("confirmed capture still requires a valid choice without guessing extra wording", () => {
  const output = (text: string) =>
    JSON.stringify({
      ok: true,
      confirmed: true,
      sessionId: "own",
      text,
      source: "dictation-reviewed",
    });
  const choices = ["Immediately", "Within two weeks"];
  assert.equal(
    parseCaptureOutput(output("Within two weeks."), "own", choices).text,
    choices[1],
  );
  assert.equal(
    parseCaptureOutput(output("second"), "own", choices).text,
    choices[1],
  );
  assert.equal(
    parseCaptureOutput(output("two weeks, within two weeks"), "own", choices)
      .code,
    "invalid_choice",
  );
});

test("confirmed text cannot be accepted while capture may still be active", () => {
  const result = parseCaptureOutput(
    JSON.stringify({
      ok: true,
      confirmed: true,
      sessionId: "own",
      text: "Within two weeks",
      captureMayBeActive: true,
    }),
    "own",
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "capture_active");
  assert.equal(result.captureMayBeActive, true);
});

test("shared capture transports Unicode through stdin and returns only confirmed content", async () => {
  const capture = createCaptureClient({
    spawnCapture: () =>
      spawn(process.execPath, ["-e", echo], {
        stdio: ["pipe", "pipe", "pipe"],
      }),
  });
  const result = await capture({
    prompt: "Bengaluru — नमस्ते",
    timeoutMs: 5_000,
  });
  assert.equal(result.ok, true);
  assert.equal(result.text, "Bengaluru — नमस्ते");
});

test("a cancelled queued capture never launches its helper", async () => {
  let launches = 0;
  const capture = createCaptureClient({
    spawnCapture: () => {
      launches++;
      return spawn(process.execPath, ["-e", `setTimeout(()=>{${echo}},100)`], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    },
  });
  const first = capture({ prompt: "first", timeoutMs: 5_000 });
  const controller = new AbortController();
  const second = capture(
    { prompt: "second", timeoutMs: 5_000 },
    controller.signal,
  );
  controller.abort();
  assert.equal((await first).ok, true);
  assert.equal((await second).code, "cancelled");
  assert.equal(launches, 1);
});

test("active cancellation closes the helper and cannot return a late answer", async () => {
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const capture = createCaptureClient({
    spawnCapture: (request) => {
      const code = `const fs=require('fs'); const p=${JSON.stringify(request.cancelFile)}; setInterval(()=>{if(fs.existsSync(p))process.exit(0)},10);`;
      const child = spawn(process.execPath, ["-e", code], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      ready();
      return child;
    },
  });
  const controller = new AbortController();
  const result = capture(
    { prompt: "cancel me", timeoutMs: 5_000 },
    controller.signal,
  );
  await started;
  controller.abort();
  assert.equal((await result).code, "cancelled");
});

test("helper crashes and oversized output return bounded errors without stderr content", async () => {
  const crash = createCaptureClient({
    spawnCapture: () =>
      spawn(
        process.execPath,
        ["-e", "console.error('PRIVATE ANSWER');process.exit(1)"],
        { stdio: ["pipe", "pipe", "pipe"] },
      ),
  });
  assert.doesNotMatch(
    JSON.stringify(await crash({ prompt: "test", timeoutMs: 5_000 })),
    /PRIVATE ANSWER/,
  );
  const noisy = createCaptureClient({
    spawnCapture: () =>
      spawn(
        process.execPath,
        ["-e", "process.stdout.write('x'.repeat(70000))"],
        { stdio: ["pipe", "pipe", "pipe"] },
      ),
  });
  assert.equal(
    (await noisy({ prompt: "test", timeoutMs: 5_000 })).code,
    "output_limit",
  );
});
