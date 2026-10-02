import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { startJob } from "@/lib/dubbing/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Retry failed segments (or a failed assembly) of a job. */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const job = await db.dubbingJob.findUnique({ where: { id } });
  if (!job) {
    return NextResponse.json(
      { ok: false, error: "المهمة غير موجودة" },
      { status: 404 }
    );
  }
  if (job.status === "processing" || job.status === "queued") {
    return NextResponse.json({ ok: true, note: "already running" });
  }

  await db.dubbingSegment.updateMany({
    where: { jobId: id, status: "failed" },
    data: { status: "pending", error: null },
  });
  await db.dubbingJob.update({
    where: { id },
    data: { status: "queued", error: null },
  });

  startJob(id);
  return NextResponse.json({ ok: true });
}
