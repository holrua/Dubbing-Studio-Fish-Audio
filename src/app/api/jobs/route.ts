import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { computeWindows, parseScript } from "@/lib/dubbing/script-parser";
import { startJob } from "@/lib/dubbing/pipeline";
import { FISH_CONFIG } from "@/lib/dubbing/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a dubbing job: parse the script, store job + segments, kick off the
 * background pipeline (TTS per segment -> fit -> assemble -> loudnorm MP3).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const script = typeof body.script === "string" ? body.script : "";
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const referenceId =
      typeof body.referenceId === "string" ? body.referenceId.trim() : "";
    const prosodySpeed =
      typeof body.prosodySpeed === "number" ? body.prosodySpeed : 1;
    const concurrency =
      typeof body.concurrency === "number" ? Math.round(body.concurrency) : 3;

    if (!script.trim()) {
      return NextResponse.json(
        { ok: false, error: "السكريبت فارغ" },
        { status: 400 }
      );
    }
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "مفتاح Fish Audio API مطلوب" },
        { status: 400 }
      );
    }
    if (!referenceId) {
      return NextResponse.json(
        { ok: false, error: "المعرف المرجعي (Reference ID) مطلوب" },
        { status: 400 }
      );
    }

    const parsed = parseScript(script);
    const win = computeWindows(parsed);
    if (win.segments.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "لم يتم العثور على أي مقاطع — تأكد من الصيغة مثل: [0:00:00.880] النص هنا",
        },
        { status: 400 }
      );
    }
    if (win.segments.length > 300) {
      return NextResponse.json(
        {
          ok: false,
          error: `عدد المقاطع (${win.segments.length}) يتجاوز الحد الأقصى 300`,
        },
        { status: 400 }
      );
    }

    const settings = {
      apiKey,
      referenceId,
      model: FISH_CONFIG.model,
      prosodySpeed: Math.min(2, Math.max(0.5, prosodySpeed)),
      concurrency: Math.min(5, Math.max(1, concurrency)),
    };

    const job = await db.dubbingJob.create({
      data: {
        status: "queued",
        script,
        settings: JSON.stringify(settings),
      },
    });

    await db.dubbingSegment.createMany({
      data: win.segments.map((s) => ({
        jobId: job.id,
        idx: s.idx,
        startMs: s.startMs,
        endMs: s.endMs,
        windowEndMs: s.windowEndMs,
        text: s.text,
      })),
    });

    // Fire-and-forget: the worker runs in this long-lived server process
    startJob(job.id);

    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `فشل إنشاء المهمة: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
