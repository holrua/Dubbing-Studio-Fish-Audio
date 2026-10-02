import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isRunning, requestCancel } from "@/lib/dubbing/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Request cancellation of a running/queued job. */
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

  requestCancel(id);

  // If the worker is not actually running (e.g. queued but never started,
  // or the server restarted), mark cancelled directly.
  if (
    !isRunning(id) &&
    (job.status === "queued" || job.status === "processing")
  ) {
    await db.dubbingJob.update({
      where: { id },
      data: { status: "cancelled" },
    });
  }
  return NextResponse.json({ ok: true });
}
