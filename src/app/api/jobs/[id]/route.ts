import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  OUTPUT_ROOT,
  isRunning,
  recoverStaleJob,
  requestCancel,
} from "@/lib/dubbing/pipeline";
import type { JobDTO, SegmentDTO } from "@/lib/dubbing/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toSegmentDTO(s: {
  idx: number;
  startMs: number;
  endMs: number | null;
  windowEndMs: number | null;
  text: string;
  status: string;
  genDurationMs: number | null;
  durationMs: number | null;
  prosodySpeed: number | null;
  atempo: number | null;
  attempts: number;
  error: string | null;
  note: string | null;
}): SegmentDTO {
  return {
    idx: s.idx,
    startMs: s.startMs,
    endMs: s.endMs,
    windowEndMs: s.windowEndMs,
    text: s.text,
    status: s.status as SegmentDTO["status"],
    genDurationMs: s.genDurationMs,
    durationMs: s.durationMs,
    prosodySpeed: s.prosodySpeed,
    atempo: s.atempo,
    attempts: s.attempts,
    error: s.error,
    note: s.note,
  };
}

/** Poll job status (with per-segment progress). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  await recoverStaleJob(id);

  const job = await db.dubbingJob.findUnique({
    where: { id },
    include: { segments: { orderBy: { idx: "asc" } } },
  });
  if (!job) {
    return NextResponse.json(
      { ok: false, error: "المهمة غير موجودة" },
      { status: 404 }
    );
  }

  const dto: JobDTO = {
    id: job.id,
    status: job.status as JobDTO["status"],
    totalSegments: job.segments.length,
    doneCount: job.segments.filter((s) => s.status === "done").length,
    failedCount: job.segments.filter((s) => s.status === "failed").length,
    totalDurationMs: job.totalDurationMs,
    error: job.error,
    segments: job.segments.map(toSegmentDTO),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
  return NextResponse.json(dto);
}

/**
 * Delete a saved project permanently:
 *   1. stop the pipeline if it is still running (wait briefly for shutdown)
 *   2. remove all output files (output/jobs/<id>/)
 *   3. remove the DB records (segments cascade-delete with the job)
 * Idempotent: deleting a non-existent job still returns { ok: true }.
 */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  try {
    // 1) Stop the background pipeline if it is running, then wait for it
    //    to settle so it cannot recreate files after we remove them.
    if (isRunning(id)) {
      requestCancel(id);
      const deadline = Date.now() + 20_000;
      while (isRunning(id) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    // 2) Remove generated files (segments, master, log — the whole folder)
    await fs.rm(path.join(OUTPUT_ROOT, id), {
      recursive: true,
      force: true,
    });

    // 3) Remove DB records (segments cascade). Missing job = already gone.
    await db.dubbingJob.delete({ where: { id } }).catch((e) => {
      const code = (e as { code?: string })?.code;
      if (code === "P2025") return undefined; // not found — treat as deleted
      throw e;
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `تعذر حذف المشروع: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
