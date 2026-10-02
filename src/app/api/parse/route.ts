import { NextResponse } from "next/server";
import { computeWindows, parseScript } from "@/lib/dubbing/script-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Parse a timestamped script into segments + windows (preview only). */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { script?: unknown };
    const script = typeof body.script === "string" ? body.script : "";
    if (!script.trim()) {
      return NextResponse.json(
        { ok: false, error: "السكريبت فارغ — الصق النص مع الطوابع الزمنية" },
        { status: 400 }
      );
    }
    if (script.length > 200_000) {
      return NextResponse.json(
        { ok: false, error: "السكريبت طويل جداً (الحد الأقصى 200 ألف حرف)" },
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

    return NextResponse.json({
      ok: true,
      segments: win.segments.map((s) => ({
        idx: s.idx,
        startMs: s.startMs,
        endMs: s.endMs,
        windowEndMs: s.windowEndMs,
        text: s.text,
      })),
      warnings: win.warnings.slice(0, 20),
      totalEndMs: win.totalEndMs,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `فشل التحليل: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
