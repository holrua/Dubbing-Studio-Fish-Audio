/**
 * Timestamped-script parser for the dubbing studio.
 *
 * Supported line formats (all times h:mm:ss.mmm / mm:ss.mmm, comma or dot ms):
 *   [0:00:00.880] text...                       -> start only
 *   [0:00:00.880 - 0:00:06.759] text...         -> explicit window
 *   0:00:00.599,0:00:07.960                     -> comma-separated window,
 *                                                  text on the following line(s)
 *   0:00:00.880 - 0:00:06.759 text...           -> explicit window
 *   00:00:00,880 --> 00:00:06,759 text...       -> SRT style
 *   0:00:00.880                                 -> bare timestamp, text on next line(s)
 *                                                   (if nothing follows: timeline end marker)
 *   1                                           -> SRT index line (skipped)
 *
 * Text is preserved WORD-FOR-WORD — never rewritten.
 */

import type { ParseResult, ParsedSegment } from "./types";

const TS_RE = /(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?/;

const LEAD_RE = /^\s*(?:\d{1,3}[.)\]]\s+)?[\s\[\(\{*_\-–—#>+]*/;
const RANGE_SEP_RE =
  /^[\s\]\)\}*_]*\s*(?:-->|→|->|[-–—,]|\bto\b)\s*[\s\[\(\{*_]*/;
const AFTER_TS_STRIP_RE = /^[\s\]\)\}*:.,\-–—_]+/;

function tsToMs(
  h: string | undefined,
  m: string,
  s: string,
  frac: string | undefined
): number {
  const millis = frac ? parseInt(frac.padEnd(3, "0"), 10) : 0;
  const hours = h ? parseInt(h, 10) : 0;
  return (hours * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10)) * 1000 + millis;
}

/** Try to parse a timestamp starting exactly at `from` inside `line` (sticky). */
function parseTsAt(
  line: string,
  from: number
): { ms: number; end: number } | null {
  const re = new RegExp(TS_RE.source, "y");
  re.lastIndex = from;
  const m = re.exec(line);
  if (!m) return null;
  return { ms: tsToMs(m[1], m[2], m[3], m[4]), end: from + m[0].length };
}

/** Find the LAST timestamp occurrence in a string (end side of a range). */
function lastTsIn(line: string): { ms: number; end: number } | null {
  let found: { ms: number; end: number } | null = null;
  const re = new RegExp(TS_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    found = { ms: tsToMs(m[1], m[2], m[3], m[4]), end: m.index + m[0].length };
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return found;
}

/** Extract "start [end] text" from a single line, or null if not a segment line. */
function parseSegmentLine(
  line: string
): { startMs: number; endMs: number | null; text: string } | null {
  const lead = LEAD_RE.exec(line);
  if (!lead) return null;
  const tsStart = lead[0].length;
  if (tsStart >= line.length) return null;

  const first = parseTsAt(line, tsStart);
  if (!first) return null;

  let pos = first.end;
  let endMs: number | null = null;

  // optional explicit end: separator + second timestamp
  const sep = RANGE_SEP_RE.exec(line.slice(pos));
  if (sep) {
    const second = parseTsAt(line, pos + sep[0].length);
    if (second) {
      endMs = second.ms;
      pos = second.end;
    }
  }

  const text = line.slice(pos).replace(AFTER_TS_STRIP_RE, "").trim();
  return { startMs: first.ms, endMs, text };
}

export function parseScript(raw: string): ParseResult {
  const warnings: string[] = [];
  const segments: ParsedSegment[] = [];

  const lines = raw.split(/\r?\n/);

  let pendingStart: number | null = null; // bare timestamp waiting for its text line
  let pendingEnd: number | null = null; // explicit end for the pending start (SRT style)

  const flushPending = (text: string) => {
    if (pendingStart === null) return;
    segments.push({
      startMs: pendingStart,
      endMs: pendingEnd,
      text: text.replace(AFTER_TS_STRIP_RE, "").trim(),
    });
    pendingStart = null;
    pendingEnd = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // SRT index line
    if (/^\d+$/.test(line)) continue;

    // SRT-style arrow line: "00:00:00,880 --> 00:00:06,759" (+ optional inline text)
    if (line.includes("-->")) {
      const first = parseTsAt(line, 0);
      if (!first) continue; // malformed arrow line — treat as text below? skip.
      const arrowPos = line.indexOf("-->");
      const tail = line.slice(arrowPos + 3);
      const second = lastTsIn(tail);
      if (!second || second.ms < first.ms) continue;
      const inlineText = tail
        .slice(second.end)
        .replace(AFTER_TS_STRIP_RE, "")
        .trim();
      if (inlineText) {
        // full SRT block on one line
        segments.push({ startMs: first.ms, endMs: second.ms, text: inlineText });
      } else {
        // timing only — text on the following line(s)
        pendingStart = first.ms;
        pendingEnd = second.ms;
      }
      continue;
    }

    const seg = parseSegmentLine(line);
    if (seg) {
      if (seg.text) {
        // a bare pending timestamp with no text between was an end marker or
        // an orphan; either way it is replaced by this real segment
        pendingStart = null;
        pendingEnd = null;
        segments.push(seg);
      } else if (seg.endMs !== null) {
        // timing line without inline text (SRT-ish)
        pendingStart = seg.startMs;
        pendingEnd = seg.endMs;
      } else {
        // bare timestamp — text may follow on the next line; if the script
        // ends here it acts as the timeline end marker
        pendingStart = seg.startMs;
        pendingEnd = null;
      }
      continue;
    }

    // plain text line
    if (pendingStart !== null) {
      flushPending(line);
    } else if (segments.length > 0) {
      // wrapped text: append to previous segment
      const prev = segments[segments.length - 1];
      prev.text = `${prev.text} ${line}`.trim();
    }
    // text before any timestamp is ignored
  }

  // Any leftover bare timestamp with no text -> timeline end marker
  let scriptEndMs: number | null = null;
  if (pendingStart !== null) {
    scriptEndMs = pendingStart;
    pendingStart = null;
  }

  // Filter empty texts
  const kept: ParsedSegment[] = [];
  for (const s of segments) {
    if (!s.text) {
      warnings.push(`مقطع عند ${s.startMs}ms بدون نص — تم تجاهله`);
      continue;
    }
    kept.push(s);
  }

  // Sort by start time (stable), warn when input order was changed
  const orderChanged = kept.some(
    (s, i) => i > 0 && s.startMs < kept[i - 1].startMs
  );
  const sorted = [...kept].sort((a, b) => a.startMs - b.startMs);
  if (orderChanged) {
    warnings.push(
      "بعض الطوابع الزمنية لم تكن مرتبة تصاعدياً — تمت إعادة الترتيب حسب وقت البداية"
    );
  }

  // Deduplicate identical start times (keep first, warn)
  const deduped: ParsedSegment[] = [];
  for (const s of sorted) {
    if (deduped.length && s.startMs === deduped[deduped.length - 1].startMs) {
      warnings.push(
        `تكرار نفس وقت البداية (${s.startMs}ms) — تم الاحتفاظ بأول مقطع فقط`
      );
      continue;
    }
    deduped.push(s);
  }

  // scriptEndMs = max(trailing marker, max explicit end)
  for (const s of deduped) {
    if (s.endMs !== null) {
      scriptEndMs = Math.max(scriptEndMs ?? 0, s.endMs);
    }
  }

  return { segments: deduped, scriptEndMs, warnings };
}

export interface WindowedSegment {
  idx: number;
  startMs: number;
  endMs: number | null;
  windowEndMs: number | null;
  text: string;
}

/**
 * Compute the placement window for every segment:
 * window end = explicit end (clamped to next start) or next segment start.
 */
export function computeWindows(
  parsed: ParseResult
): { segments: WindowedSegment[]; warnings: string[]; totalEndMs: number | null } {
  const warnings = [...parsed.warnings];
  const segs = parsed.segments;
  const out: WindowedSegment[] = [];

  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const nextStart = i + 1 < segs.length ? segs[i + 1].startMs : null;

    let windowEndMs: number | null = null;
    if (s.endMs !== null) {
      windowEndMs = s.endMs;
      if (nextStart !== null && windowEndMs > nextStart) {
        warnings.push(
          `نهاية المقطع ${i + 1} تتجاوز بداية المقطع التالي — تم تقييد النافذة عند بداية التالي`
        );
        windowEndMs = nextStart;
      }
      if (windowEndMs <= s.startMs) {
        warnings.push(
          `نافذة المقطع ${i + 1} غير صالحة (نهاية <= بداية) — تم تجاهل النهاية`
        );
        windowEndMs = null;
      }
    } else if (nextStart !== null) {
      windowEndMs = nextStart;
    }

    if (i > 0 && s.startMs - segs[i - 1].startMs < 200) {
      warnings.push(`المقطع ${i + 1} يبدأ بعد بداية المقطع السابق بأقل من 200ms`);
    }

    out.push({
      idx: i,
      startMs: s.startMs,
      endMs: s.endMs,
      windowEndMs,
      text: s.text,
    });
  }

  return { segments: out, warnings, totalEndMs: parsed.scriptEndMs };
}
