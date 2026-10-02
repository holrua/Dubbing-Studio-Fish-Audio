/**
 * Shared types + constants for the automatic dubbing studio.
 * Used by both the API routes (server) and the UI (client).
 */

export type JobStatus = "queued" | "processing" | "done" | "error" | "cancelled";

export type SegmentStatus =
  | "pending"
  | "generating"
  | "fitting"
  | "done"
  | "failed";

/** Fixed Fish Audio TTS request parameters (identical to the original run). */
export const FISH_CONFIG = {
  model: "s2.1-pro-free",
  temperature: 0.7,
  topP: 0.7,
  chunkLength: 300,
  normalize: true,
  format: "mp3" as const,
  sampleRate: 44100,
  mp3Bitrate: 128,
  latency: "normal" as const,
};

export const DEFAULT_REFERENCE_ID = "12a85233597842b6a4e169c3db4ec1e0";
export const DEFAULT_API_KEY =
  "sk-fish-z7RghAOi2M0PYrXx3-MpFggoZCjQHVVFjEwgU6I0Kys";

/** Fitting rules (mirrors the original voiceover/generate.py logic). */
export const FIT_RULES = {
  /** prosody.speed official range */
  minProsody: 0.5,
  maxProsody: 2.0,
  /** margin trimmed from each window so speech never bleeds into the next slot */
  marginFixedSec: 0.1,
  marginRatio: 0.015,
  /** if factor <= this, a micro atempo is used; otherwise regenerate with prosody.speed */
  microAtempoThreshold: 1.15,
  /** hard cap for ffmpeg atempo per segment */
  maxAtempo: 2.0,
  /** TTS attempts per synthesis call */
  maxTries: 5,
};

export interface ParsedSegment {
  startMs: number;
  endMs: number | null; // explicit end given in the script
  text: string;
}

export interface ParseResult {
  segments: ParsedSegment[];
  /** trailing bare timestamp / max explicit end — the timeline must extend to it */
  scriptEndMs: number | null;
  warnings: string[];
}

export interface SegmentDTO {
  idx: number;
  startMs: number;
  endMs: number | null;
  windowEndMs: number | null;
  text: string;
  status: SegmentStatus;
  genDurationMs: number | null;
  durationMs: number | null;
  prosodySpeed: number | null;
  atempo: number | null;
  attempts: number;
  error: string | null;
  note: string | null;
}

export interface JobDTO {
  id: string;
  status: JobStatus;
  totalSegments: number;
  doneCount: number;
  failedCount: number;
  totalDurationMs: number | null;
  error: string | null;
  segments: SegmentDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface ParseResponse {
  ok: boolean;
  error?: string;
  segments?: Array<{
    idx: number;
    startMs: number;
    endMs: number | null;
    windowEndMs: number | null;
    text: string;
  }>;
  warnings?: string[];
  totalEndMs?: number | null;
}

export interface CreateJobPayload {
  script: string;
  apiKey: string;
  referenceId: string;
  prosodySpeed?: number;
  concurrency?: number;
}

export interface CreateJobResponse {
  ok: boolean;
  jobId?: string;
  error?: string;
}

/** Formats milliseconds as h:mm:ss.mmm (e.g. 412280 -> 0:06:52.280). */
export function formatMs(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const milli = Math.floor(ms % 1000);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
}

/** Short format m:ss.d for compact UI display. */
export function formatShort(ms: number): string {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}
