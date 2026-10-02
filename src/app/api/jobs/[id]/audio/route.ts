import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { OUTPUT_ROOT } from "@/lib/dubbing/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serve the final merged MP3.
 *   GET /api/jobs/{id}/audio        -> inline (for the <audio> player)
 *   GET /api/jobs/{id}/audio?dl=1   -> attachment download
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const job = await db.dubbingJob.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!job) {
    return NextResponse.json(
      { ok: false, error: "المهمة غير موجودة" },
      { status: 404 }
    );
  }
  if (job.status !== "done") {
    return NextResponse.json(
      { ok: false, error: "الملف الصوتي غير جاهز بعد" },
      { status: 404 }
    );
  }

  const file = path.join(OUTPUT_ROOT, id, "final.mp3");
  let buf: Buffer;
  try {
    buf = await fs.readFile(file);
  } catch {
    return NextResponse.json(
      { ok: false, error: "ملف الصوت مفقود على القرص" },
      { status: 404 }
    );
  }

  const dl = new URL(req.url).searchParams.get("dl");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(buf.length),
      "Cache-Control": "no-store",
      ...(dl
        ? { "Content-Disposition": `attachment; filename="dubbing_${id}.mp3"` }
        : {}),
    },
  });
}
