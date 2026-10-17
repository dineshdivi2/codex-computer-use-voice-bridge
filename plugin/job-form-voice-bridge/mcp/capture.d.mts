import type { ChildProcessWithoutNullStreams } from "node:child_process";
export interface CaptureRequest {
  prompt: string;
  context?: string;
  taskTitle?: string;
  options?: string[];
  timeoutMs?: number;
  hotkey?: string;
  historyRoot?: string;
  legacyHistoryFile?: string;
  autoStopSeconds?: number;
}
export interface CaptureResult {
  ok: boolean;
  text?: string;
  confirmed?: boolean;
  source?: "typed" | "dictation-reviewed";
  totalElapsedMs?: number | null;
  code?: string;
  error?: string;
  captureMayBeActive?: boolean;
}
export interface CaptureClientOptions {
  launcherScript?: string;
  powershellBinary?: string;
  spawnCapture?: (
    payload: CaptureRequest & { sessionId: string; cancelFile: string },
  ) => ChildProcessWithoutNullStreams;
}
export function createCaptureClient(
  options?: CaptureClientOptions,
): (request: CaptureRequest, signal?: AbortSignal) => Promise<CaptureResult>;
export function parseCaptureOutput(
  stdout: string,
  sessionId: string,
  choices?: string[],
): CaptureResult;
export const captureDictation: ReturnType<typeof createCaptureClient>;
