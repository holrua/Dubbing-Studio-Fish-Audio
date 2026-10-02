import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recoverStaleJob } from "@/lib/dubbing/pipeline";
import type { JobDTO } from "@/lib/dubbing/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Most recent job (any status) — lets the UI restore state after a reload. */
export async function GET() {
  const job = await db.dubbingJob.findFirst({
    orderBy: { createdAt: "desc" },
    include: { segments: { orderBy: { idx: "asc" } } },
  });
  if (!job) {
    return NextResponse.json({ ok: true, job: null });
  }

  await recoverStaleJob(job.id);
  const fresh = await db.dubbingJob.findUnique({
    where: { id: job.id },
    include: { segments: { orderBy: { idx: "asc" } } },
  });
  if (!fresh) {
    return NextResponse.json({ ok: true, job: null });
  }

  const dto: JobDTO = {
    id: fresh.id,
    status: fresh.status as JobDTO["status"],
    totalSegments: fresh.segments.length,
    doneCount: fresh.segments.filter((s) => s.status === "done").length,
    failedCount: fresh.segments.filter((s) => s.status === "failed").length,
    totalDurationMs: fresh.totalDurationMs,
    error: fresh.error,
    segments: fresh.segments.map((s) => ({
      idx: s.idx,
      startMs: s.startMs,
      endMs: s.endMs,
      windowEndMs: s.windowEndMs,
      text: s.text,
      status: s.status as JobDTO["segments"][number]["status"],
      genDurationMs: s.genDurationMs,
      durationMs: s.durationMs,
      prosodySpeed: s.prosodySpeed,
      atempo: s.atempo,
      attempts: s.attempts,
      error: s.error,
      note: s.note,
    })),
    createdAt: fresh.createdAt.toISOString(),
    updatedAt: fresh.updatedAt.toISOString(),
  };
  return NextResponse.json({ ok: true, job: dto });
}
