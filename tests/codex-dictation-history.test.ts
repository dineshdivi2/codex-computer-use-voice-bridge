import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { CodexDictationHistory } from "../src/codex-dictation-history.ts";

async function fixture(): Promise<{
  root: string;
  rich: string;
  legacy: string;
  history: CodexDictationHistory;
}> {
  const root = await mkdtemp(join(tmpdir(), "codex-dictation-history-"));
  const rich = join(root, "dictation-history");
  const legacy = join(root, "transcription-history.jsonl");
  await mkdir(rich);
  await writeFile(legacy, "", "utf8");
  return {
    root,
    rich,
    legacy,
    history: new CodexDictationHistory({
      historyRoot: rich,
      legacyHistoryFile: legacy,
      pollIntervalMs: 10,
      clockSkewMs: 0,
    }),
  };
}

async function writeRich(
  root: string,
  folder: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const target = join(root, folder);
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "metadata.json"), JSON.stringify(metadata), "utf8");
}

test("waits for a new completed global transcript with non-empty text", async () => {
  const files = await fixture();
  try {
    await writeRich(files.rich, "old", {
      id: "old-id",
      createdAtMs: Date.now() - 5_000,
      status: "completed",
      surface: "global",
      text: "old answer",
    });
    const baselineIds = await files.history.snapshotIds();
    const startedAtMs = Date.now();
    const waiting = files.history.waitForTranscript({
      baselineIds,
      startedAtMs,
      timeoutMs: 1_000,
      surface: "global",
    });

    await writeRich(files.rich, "new", {
      id: "new-id",
      createdAtMs: startedAtMs,
      status: "completed",
      surface: "global",
      text: "",
    });
    await delay(30);
    await writeRich(files.rich, "new", {
      id: "new-id",
      createdAtMs: startedAtMs,
      durationMs: 1_250,
      status: "completed",
      surface: "global",
      text: "Three months",
    });

    assert.deepEqual(await waiting, {
      id: "new-id",
      createdAtMs: startedAtMs,
      durationMs: 1_250,
      surface: "global",
      text: "Three months",
      source: "rich-history",
    });
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});

test("ignores composer history and can use the global legacy record", async () => {
  const files = await fixture();
  try {
    const baselineIds = await files.history.snapshotIds();
    const startedAtMs = Date.now();
    const waiting = files.history.waitForTranscript({
      baselineIds,
      startedAtMs,
      timeoutMs: 1_000,
      surface: "global",
    });

    await writeRich(files.rich, "composer", {
      id: "composer-id",
      createdAtMs: startedAtMs,
      status: "completed",
      surface: "composer",
      text: "unrelated composer dictation",
    });
    await writeFile(
      files.legacy,
      `${JSON.stringify({
        id: "legacy-global-id",
        createdAtMs: startedAtMs + 1,
        text: "Yes, I require sponsorship",
      })}\n`,
      "utf8",
    );

    const transcript = await waiting;
    assert.equal(transcript.id, "legacy-global-id");
    assert.equal(transcript.source, "legacy-history");
    assert.equal(transcript.text, "Yes, I require sponsorship");
  } finally {
    await rm(files.root, { recursive: true, force: true });
  }
});
