/**
 * Dubbing pipeline — replicates the original voiceover workflow as a
 * background job:
 *
 *   1. Per segment (worker pool): Fish Audio TTS at base prosody speed
 *      -> measure duration (ffprobe)
 *      -> fit into its exact window:
 *            fits                -> keep natural pacing (silence fills the slot)
 *            overflow <= 1.15x   -> micro ffmpeg atempo
 *            overflow >  1.15x   -> regenerate with official prosody.speed (0.5-2.0)
 *                                   + residual atempo (cap 2.0)
 *      -> fitted 44.1kHz mono s16 WAV
 *   2. Assembly: master timeline of exact total length; every segment placed
 *      at its exact start (adelay), hard-truncated at its window end, summed
 *      (amix normalize=0) and padded with silence to the total length.
 *   3. Mastering: two-pass loudness normalization to -16 LUFS / -1.5 dBTP
 *      (linear gain when possible), exported as MP3 44.1kHz mono 128kbps CBR.
 */

import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { synthesizeToFile } from "./fish-tts";
import { probeDurationMs, run, tryProbeMs } from "./ffmpeg";
import { parseScript } from "./script-parser";
import { FIT_RULES } from "./types";

export const OUTPUT_ROOT = path.join(process.cwd(), "output", "jobs");

const STALE_MS = 3 * 60 * 1000;

export interface JobSettings {
  apiKey: string;
  referenceId: string;
  model: string;
  prosodySpeed: number;
  concurrency: number;
}

const runningJobs = new Set<string>();
const cancelFlags = new Set<string>();

type DbSegment = Awaited<
  ReturnType<typeof db.dubbingSegment.findMany>
>[number];

export function isRunning(jobId: string): boolean {
  return runningJobs.has(jobId);
}

export function requestCancel(jobId: string): void {
  cancelFlags.add(jobId);
}

/** Kick off (or resume) a job in the background. */
export function startJob(jobId: string): void {
  if (runningJobs.has(jobId)) return;
  runningJobs.add(jobId);
  cancelFlags.delete(jobId);
  void runJob(jobId)
    .catch(async (e) => {
      await db.dubbingJob
        .update({
          where: { id: jobId },
          data: {
            status: "error",
            error: `خطأ غير متوقع: ${String((e as Error)?.message ?? e).slice(0, 300)}`,
          },
        })
        .catch(() => undefined);
    })
    .finally(() => {
      runningJobs.delete(jobId);
      cancelFlags.delete(jobId);
    });
}

async function appendLog(jobId: string, line: string): Promise<void> {
  try {
    await fs.mkdir(path.join(OUTPUT_ROOT, jobId), { recursive: true });
    await fs.appendFile(
      path.join(OUTPUT_ROOT, jobId, "processing.log"),
      `[${new Date().toISOString()}] ${line}\n`
    );
  } catch {
    /* logging must never break the pipeline */
  }
}

async function touchJob(jobId: string): Promise<void> {
  await db.dubbingJob
    .update({ where: { id: jobId }, data: { updatedAt: new Date() } })
    .catch(() => undefined);
}

async function updateSegment(jobId: string, id: string, data: object) {
  await db.dubbingSegment.update({ where: { id }, data });
  await touchJob(jobId);
}

async function runPool(
  items: DbSegment[],
  concurrency: number,
  shouldStop: () => boolean,
  fn: (item: DbSegment) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (next < items.length) {
        if (shouldStop()) return;
        const item = items[next++];
        await fn(item);
      }
    }
  );
  await Promise.all(workers);
}

async function runJob(jobId: string): Promise<void> {
  const dir = path.join(OUTPUT_ROOT, jobId);
  await fs.mkdir(path.join(dir, "segments"), { recursive: true });

  const log = (m: string) => void appendLog(jobId, m);

  const job = await db.dubbingJob.findUnique({
    where: { id: jobId },
    include: { segments: { orderBy: { idx: "asc" } } },
  });
  if (!job) return;

  if (cancelFlags.has(jobId)) {
    await db.dubbingJob.update({
      where: { id: jobId },
      data: { status: "cancelled" },
    });
    log("cancelled before start");
    return;
  }

  const settings = JSON.parse(job.settings) as JobSettings;
  await db.dubbingJob.update({
    where: { id: jobId },
    data: { status: "processing", error: null },
  });

  // Reset segments stuck in a transient state from an interrupted run
  await db.dubbingSegment.updateMany({
    where: { jobId, status: { in: ["generating", "fitting"] } },
    data: { status: "pending" },
  });

  const pending = job.segments.filter((s) => s.status !== "done");
  log(
    `=== job ${jobId}: ${pending.length}/${job.segments.length} segments to process (concurrency ${settings.concurrency}) ===`
  );

  const isCancelled = () => cancelFlags.has(jobId);
  let processed = 0;

  await runPool(
    pending,
    settings.concurrency,
    isCancelled,
    async (seg) => {
      await processSegment(jobId, seg, settings, log);
      processed++;
      log(`progress: ${processed}/${pending.length}`);
    }
  );

  if (isCancelled()) {
    await db.dubbingJob.update({
      where: { id: jobId },
      data: { status: "cancelled" },
    });
    log("=== cancelled by user ===");
    return;
  }

  const failed = await db.dubbingSegment.count({
    where: { jobId, status: "failed" },
  });
  if (failed > 0) {
    await db.dubbingJob.update({
      where: { id: jobId },
      data: {
        status: "error",
        error: `${failed} مقاطع فشل توليدها — اضغط "إعادة المحاولة"`,
      },
    });
    log(`=== finished with ${failed} failures ===`);
    return;
  }

  log("=== assembling master timeline ===");
  try {
    const totalMs = await assembleMaster(jobId, job.script, log);
    log(`=== done. final duration ${totalMs}ms ===`);
    await db.dubbingJob.update({
      where: { id: jobId },
      data: { status: "done", totalDurationMs: totalMs, error: null },
    });
  } catch (e) {
    const msg = String((e as Error).message).slice(0, 300);
    log(`=== assembly FAILED: ${msg} ===`);
    await db.dubbingJob.update({
      where: { id: jobId },
      data: { status: "error", error: `فشل الدمج: ${msg}` },
    });
  }
}

/** Generate + fit one segment into its exact window. */
async function processSegment(
  jobId: string,
  seg: DbSegment,
  settings: JobSettings,
  log: (m: string) => void
): Promise<void> {
  const tag = `seg${String(seg.idx).padStart(3, "0")}`;
  const segDir = path.join(OUTPUT_ROOT, jobId, "segments");
  const baseMp3 = path.join(segDir, `${tag}.mp3`);
  const regenMp3 = path.join(segDir, `${tag}_regen.mp3`);
  const outWav = path.join(segDir, `${tag}.wav`);

  const baseSpeed = Math.min(
    FIT_RULES.maxProsody,
    Math.max(FIT_RULES.minProsody, settings.prosodySpeed || 1)
  );

  const windowSec =
    seg.windowEndMs !== null ? (seg.windowEndMs - seg.startMs) / 1000 : null;
  const margin =
    windowSec !== null
      ? Math.min(FIT_RULES.marginFixedSec, windowSec * FIT_RULES.marginRatio)
      : 0;
  const effTarget = windowSec !== null ? windowSec - margin : null;

  await updateSegment(jobId, seg.id, {
    status: "generating",
    error: null,
  });

  const ttsBase = {
    apiKey: settings.apiKey,
    referenceId: settings.referenceId,
    model: settings.model,
    text: seg.text,
  };

  try {
    // ---- Phase 1: base synthesis (cached from a previous interrupted run) ----
    let genDurMs = await tryProbeMs(baseMp3);
    if (genDurMs > 300) {
      log(`${tag}: cached base audio ${genDurMs}ms (skipping synthesis)`);
    } else {
      await synthesizeToFile(
        { ...ttsBase, prosodySpeed: baseSpeed },
        baseMp3,
        tag,
        log,
        async (attempt) => {
          await updateSegment(jobId, seg.id, { attempts: attempt });
        }
      );
      genDurMs = await probeDurationMs(baseMp3);
    }
    await updateSegment(jobId, seg.id, { genDurationMs: genDurMs });

    // ---- Phase 2: fit into the exact window ----
    let chosen = baseMp3;
    let chosenSpeed = baseSpeed;
    let atempo = 1;
    let note = "سرعة طبيعية — الصمت يملأ باقي النافذة";

    if (effTarget !== null && genDurMs / 1000 > effTarget) {
      const factor = genDurMs / 1000 / effTarget;
      if (factor <= FIT_RULES.microAtempoThreshold) {
        atempo = factor;
        note = `atempo ×${atempo.toFixed(3)} (تجاوز بسيط)`;
      } else {
        const need = Math.min(
          Math.round(factor * 100) / 100,
          FIT_RULES.maxProsody
        );
        const clamped = factor > FIT_RULES.maxProsody;
        try {
          log(
            `${tag}: overflow ×${factor.toFixed(3)} — regenerating at prosody.speed=${need}`
          );
          await synthesizeToFile(
            { ...ttsBase, prosodySpeed: need },
            regenMp3,
            `${tag}-r${need}`,
            log
          );
          const gen2Ms = await probeDurationMs(regenMp3);
          chosen = regenMp3;
          chosenSpeed = need;
          if (gen2Ms / 1000 <= effTarget) {
            note = `أُعيد التوليد بسرعة ${need} (يطابق النافذة)`;
          } else {
            atempo = Math.min(gen2Ms / 1000 / effTarget, FIT_RULES.maxAtempo);
            note = `أُعيد التوليد بسرعة ${need} + atempo ×${atempo.toFixed(3)}`;
            if (clamped && atempo >= FIT_RULES.maxAtempo) {
              note += " — بلغ الحد الأقصى للتسريع";
            }
          }
        } catch (e) {
          atempo = Math.min(factor, FIT_RULES.maxAtempo);
          note = `فشلت إعادة التوليد — atempo ×${atempo.toFixed(3)} كبديل`;
          log(`${tag}: regen failed (${(e as Error).message}) — fallback atempo`);
        }
      }
    }

    await updateSegment(jobId, seg.id, { status: "fitting" });

    // ---- Convert to fitted 44.1kHz mono s16 WAV ----
    const af =
      atempo > 1.0005
        ? `atempo=${atempo.toFixed(6)},aresample=44100`
        : "aresample=44100";
    await run(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-i",
        chosen,
        "-af",
        af,
        "-ac",
        "1",
        "-ar",
        "44100",
        "-c:a",
        "pcm_s16le",
        outWav,
      ],
      120000
    );
    const finalMs = await probeDurationMs(outWav);

    await updateSegment(jobId, seg.id, {
      status: "done",
      durationMs: finalMs,
      prosodySpeed: chosenSpeed,
      atempo: atempo > 1.0005 ? Number(atempo.toFixed(4)) : 1,
      note,
      error: null,
    });
    log(`${tag}: gen=${genDurMs}ms final=${finalMs}ms [${note}]`);
  } catch (e) {
    const msg = String((e as Error).message).slice(0, 300);
    await updateSegment(jobId, seg.id, { status: "failed", error: msg });
    log(`${tag}: FAILED — ${msg}`);
  }
}

/**
 * Build the master timeline (every segment at its exact start, silence
 * everywhere else), then master loudness and export the final MP3.
 */
async function assembleMaster(
  jobId: string,
  script: string,
  log: (m: string) => void
): Promise<number> {
  const dir = path.join(OUTPUT_ROOT, jobId);
  const segDir = path.join(dir, "segments");

  const segs = await db.dubbingSegment.findMany({
    where: { jobId },
    orderBy: { idx: "asc" },
  });
  if (segs.length === 0) throw new Error("no segments to assemble");

  // Total length: script end marker / explicit ends / last speech end
  const parsed = parseScript(script);
  let totalEndMs = parsed.scriptEndMs ?? 0;
  for (const s of segs) {
    totalEndMs = Math.max(totalEndMs, s.startMs + (s.durationMs ?? 0));
    if (s.windowEndMs !== null) totalEndMs = Math.max(totalEndMs, s.windowEndMs);
  }
  if (totalEndMs <= 0) throw new Error("computed total duration is zero");
  const totalSec = (totalEndMs / 1000).toFixed(3);
  log(`total timeline: ${totalEndMs}ms (${totalSec}s)`);

  // filter_complex: aresample -> mono -> hard-trim to window -> delay -> mix
  const inputs: string[] = [];
  const chains: string[] = [];
  const labels: string[] = [];

  segs.forEach((s, i) => {
    const wav = path.join(segDir, `seg${String(s.idx).padStart(3, "0")}.wav`);
    inputs.push("-i", wav);
    let chain = "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=mono";
    if (s.windowEndMs !== null) {
      const winSec = (s.windowEndMs - s.startMs) / 1000;
      if (winSec > 0.05) {
        chain += `,atrim=end=${winSec.toFixed(3)},asetpts=PTS-STARTPTS`;
      }
    }
    chain += `,adelay=${s.startMs}:all=1`;
    chains.push(`[${i}:a]${chain}[a${i}]`);
    labels.push(`[a${i}]`);
  });

  const graph = [
    ...chains,
    `${labels.join("")}amix=inputs=${segs.length}:duration=longest:normalize=0,apad=whole_dur=${totalSec}[m]`,
  ].join(";");

  const masterWav = path.join(dir, "master.wav");
  await run(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      ...inputs,
      "-filter_complex",
      graph,
      "-map",
      "[m]",
      "-ar",
      "44100",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      masterWav,
    ],
    600000
  );

  const finalMp3 = path.join(dir, "final.mp3");
  await loudnormExport(masterWav, finalMp3, log);
  return probeDurationMs(finalMp3);
}

/**
 * Two-pass loudness normalization to -16 LUFS / -1.5 dBTP (linear gain when
 * possible — identical loudness philosophy to the original run), exported as
 * MP3 44.1kHz mono 128kbps. Falls back to single-pass, then plain export.
 */
async function loudnormExport(
  masterWav: string,
  finalMp3: string,
  log: (m: string) => void
): Promise<void> {
  const target = "I=-16:TP=-1.5:LRA=11";
  try {
    const p1 = await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        "-i",
        masterWav,
        "-af",
        `loudnorm=${target}:print_format=json`,
        "-f",
        "null",
        "-",
      ],
      600000
    );
    const blocks = p1.stderr.match(/\{[\s\S]*?\}/g);
    const last = blocks && blocks.length > 0 ? blocks[blocks.length - 1] : null;
    if (!last) throw new Error("loudnorm analysis produced no JSON");
    const m = JSON.parse(last) as Record<string, string>;
    const measured =
      `measured_I=${m.input_i}:measured_TP=${m.input_tp}:` +
      `measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:` +
      `offset=${m.target_offset}:linear=true`;
    log(`loudnorm measured I=${m.input_i} LUFS, TP=${m.input_tp} dBTP`);
    await run(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-i",
        masterWav,
        "-af",
        `loudnorm=${target}:${measured}`,
        "-ar",
        "44100",
        "-ac",
        "1",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        finalMp3,
      ],
      600000
    );
    return;
  } catch (e) {
    log(`two-pass loudnorm failed (${(e as Error).message}) — single-pass fallback`);
  }
  try {
    await run(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-i",
        masterWav,
        "-af",
        `loudnorm=${target}`,
        "-ar",
        "44100",
        "-ac",
        "1",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        finalMp3,
      ],
      600000
    );
    return;
  } catch {
    log("loudnorm unavailable — exporting raw master");
  }
  await run(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-i",
      masterWav,
      "-ar",
      "44100",
      "-ac",
      "1",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "128k",
      finalMp3,
    ],
    600000
  );
}

/**
 * Stale-job recovery: if a job claims to be running but nothing updated it
 * for STALE_MS (e.g. the dev server restarted mid-job), mark it as error so
 * the user can retry.
 */
export async function recoverStaleJob(jobId: string): Promise<boolean> {
  const job = await db.dubbingJob.findUnique({
    where: { id: jobId },
    select: { status: true, updatedAt: true },
  });
  if (!job) return false;
  if (
    (job.status === "processing" || job.status === "queued") &&
    !runningJobs.has(jobId) &&
    Date.now() - job.updatedAt.getTime() > STALE_MS
  ) {
    await db.dubbingJob.update({
      where: { id: jobId },
      data: {
        status: "error",
        error: "توقفت المعالجة بشكل غير متوقع — اضغط إعادة المحاولة",
      },
    });
    return true;
  }
  return false;
}
