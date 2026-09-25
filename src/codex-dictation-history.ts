import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export type DictationTranscriptSource = "rich-history" | "legacy-history";

export interface DictationTranscript {
  id: string;
  createdAtMs: number;
  text: string;
  source: DictationTranscriptSource;
  surface?: string;
  durationMs?: number;
}

interface RichMetadata {
  id?: unknown;
  createdAtMs?: unknown;
  durationMs?: unknown;
  status?: unknown;
  surface?: unknown;
  text?: unknown;
}

interface LegacyMetadata {
  id?: unknown;
  createdAtMs?: unknown;
  text?: unknown;
}

export interface DictationHistoryOptions {
  historyRoot?: string;
  legacyHistoryFile?: string;
  pollIntervalMs?: number;
  clockSkewMs?: number;
}

export interface WaitForDictationOptions {
  baselineIds: ReadonlySet<string>;
  startedAtMs: number;
  timeoutMs: number;
  surface?: string;
  signal?: AbortSignal;
}

function isMissing(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT",
  );
}

function parseCreatedAt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export class CodexDictationHistory {
  readonly historyRoot: string;
  readonly legacyHistoryFile: string;
  readonly #pollIntervalMs: number;
  readonly #clockSkewMs: number;

  constructor(options: DictationHistoryOptions = {}) {
    const codexHome = join(homedir(), ".codex");
    this.historyRoot = options.historyRoot ?? join(codexHome, "dictation-history");
    this.legacyHistoryFile =
      options.legacyHistoryFile ?? join(codexHome, "transcription-history.jsonl");
    this.#pollIntervalMs = options.pollIntervalMs ?? 250;
    this.#clockSkewMs = options.clockSkewMs ?? 3_000;
  }

  async snapshotIds(): Promise<Set<string>> {
    const records = await this.#readRecords();
    return new Set(records.map((record) => record.id));
  }

  async waitForTranscript(options: WaitForDictationOptions): Promise<DictationTranscript> {
    const deadline = Date.now() + options.timeoutMs;
    const earliestCreatedAt = options.startedAtMs - this.#clockSkewMs;

    while (Date.now() <= deadline) {
      options.signal?.throwIfAborted();
      const candidates = (await this.#readRecords())
        .filter((record) => !options.baselineIds.has(record.id))
        .filter((record) => record.createdAtMs >= earliestCreatedAt)
        .filter(
          (record) =>
            record.source === "legacy-history" ||
            options.surface === undefined ||
            record.surface === options.surface,
        )
        .sort((left, right) => left.createdAtMs - right.createdAtMs);
      const transcript = candidates[0];
      if (transcript) return transcript;

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await delay(Math.min(this.#pollIntervalMs, remaining), undefined, {
        signal: options.signal,
      });
    }

    throw new Error("Timed out waiting for a completed Codex Dictation transcript");
  }

  async #readRecords(): Promise<DictationTranscript[]> {
    const [rich, legacy] = await Promise.all([
      this.#readRichRecords(),
      this.#readLegacyRecords(),
    ]);
    const records = new Map<string, DictationTranscript>();
    for (const record of legacy) records.set(record.id, record);
    for (const record of rich) records.set(record.id, record);
    return [...records.values()];
  }

  async #readRichRecords(): Promise<DictationTranscript[]> {
    let entries;
    try {
      entries = await readdir(this.historyRoot, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }

    const records = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry): Promise<DictationTranscript | null> => {
          try {
            const raw = await readFile(join(this.historyRoot, entry.name, "metadata.json"), "utf8");
            const metadata = JSON.parse(raw) as RichMetadata;
            const id = typeof metadata.id === "string" ? metadata.id : "";
            const createdAtMs = parseCreatedAt(metadata.createdAtMs);
            const text = cleanText(metadata.text);
            if (!id || createdAtMs === null || metadata.status !== "completed" || !text) {
              return null;
            }
            return {
              id,
              createdAtMs,
              text,
              source: "rich-history",
              ...(typeof metadata.surface === "string" ? { surface: metadata.surface } : {}),
              ...(typeof metadata.durationMs === "number" && Number.isFinite(metadata.durationMs)
                ? { durationMs: metadata.durationMs }
                : {}),
            };
          } catch (error) {
            // Codex updates metadata in place. Ignore missing, locked, or partial JSON and retry.
            if (isMissing(error) || error instanceof SyntaxError) return null;
            const code = error && typeof error === "object" && "code" in error
              ? (error as { code?: unknown }).code
              : undefined;
            if (code === "EBUSY" || code === "EPERM") return null;
            throw error;
          }
        }),
    );
    return records.filter((record): record is DictationTranscript => record !== null);
  }

  async #readLegacyRecords(): Promise<DictationTranscript[]> {
    let raw: string;
    try {
      raw = await readFile(this.legacyHistoryFile, "utf8");
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }

    const records: DictationTranscript[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const metadata = JSON.parse(line) as LegacyMetadata;
        const id = typeof metadata.id === "string" ? metadata.id : "";
        const createdAtMs = parseCreatedAt(metadata.createdAtMs);
        const text = cleanText(metadata.text);
        if (!id || createdAtMs === null || !text) continue;
        records.push({ id, createdAtMs, text, source: "legacy-history" });
      } catch {
        // A concurrently appended final line can be incomplete. The next poll will retry it.
      }
    }
    return records;
  }
}
