# -*- coding: utf-8 -*-
"""
Fish Audio TTS generation + exact duration fitting.

Phase 1: synthesize every segment at prosody.speed = 1.0 (resumable, concurrent, retries)
Phase 2: fit each segment into its exact [start, end] window:
         - too long  -> regenerate with prosody.speed (official range 0.5-2.0) if factor > 1.15,
                        then residual ffmpeg atempo for a frame-exact fit
         - too short -> keep natural pacing, trailing silence fills the slot
         - build fitted 44.1kHz mono 16-bit WAVs
Writes: wav/segNNN.wav + report.json
"""
import json
import os
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from segments import SEGMENTS, REFERENCE_ID

BASE = os.path.dirname(os.path.abspath(__file__))
SEG_DIR = os.path.join(BASE, "segments")
WAV_DIR = os.path.join(BASE, "wav")
LOG_DIR = os.path.join(BASE, "logs")
os.makedirs(SEG_DIR, exist_ok=True)
os.makedirs(WAV_DIR, exist_ok=True)
os.makedirs(LOG_DIR, exist_ok=True)

API_URL = "https://api.fish.audio/v1/tts"
API_KEY = os.environ.get(
    "FISH_API_KEY", "sk-fish-z7RghAOi2M0PYrXx3-MpFggoZCjQHVVFjEwgU6I0Kys"
).strip()
MODEL = "s2.1-pro-free"
PROGRESS_FILE = os.path.join(LOG_DIR, "progress.txt")
REPORT_FILE = os.path.join(BASE, "report.json")

MAX_WORKERS = 3
MAX_TRIES = 7

_print_lock = threading.Lock()


def log(msg):
    with _print_lock:
        line = f"[{time.strftime('%H:%M:%S')}] {msg}"
        print(line, flush=True)
        with open(PROGRESS_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")


def build_payload(text, speed):
    return {
        "text": text,
        "reference_id": REFERENCE_ID,
        "temperature": 0.7,
        "top_p": 0.7,
        "prosody": {"speed": speed, "volume": 0, "normalize_loudness": True},
        "chunk_length": 300,
        "normalize": True,
        "format": "mp3",
        "sample_rate": 44100,
        "mp3_bitrate": 128,
        "latency": "normal",
    }


def ffprobe_duration(path):
    try:
        out = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=nw=1:nk=1", path,
            ],
            capture_output=True, text=True, timeout=30,
        ).stdout.strip()
        return float(out)
    except Exception:
        return -1.0


def is_valid_mp3(path):
    if not os.path.exists(path) or os.path.getsize(path) < 2048:
        return False
    return ffprobe_duration(path) > 1.0


def synthesize(text, speed, out_path, tag=""):
    """Call Fish Audio TTS with retries. Returns True on success."""
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "model": MODEL,
    }
    payload = build_payload(text, speed)
    for attempt in range(1, MAX_TRIES + 1):
        try:
            r = requests.post(
                API_URL, headers=headers, json=payload, timeout=180, stream=True
            )
            if r.status_code == 200 and "audio" in r.headers.get("Content-Type", ""):
                with open(out_path, "wb") as f:
                    for chunk in r.iter_content(chunk_size=65536):
                        if chunk:
                            f.write(chunk)
                if is_valid_mp3(out_path):
                    return True
                err = "invalid/short audio file"
            else:
                err = f"HTTP {r.status_code}: {r.text[:180]}"
        except Exception as e:
            err = f"{type(e).__name__}: {e}"
        wait = min(3 * (2 ** (attempt - 1)), 60)
        log(f"  {tag} attempt {attempt}/{MAX_TRIES} failed ({err}); retry in {wait}s")
        time.sleep(wait)
    return False


def fit_wav(src_mp3, dst_wav, atempo):
    """Convert chosen mp3 -> 44.1kHz mono s16 wav, applying atempo if needed."""
    af = "aresample=44100" if atempo <= 1.0005 else f"atempo={atempo:.6f},aresample=44100"
    cmd = [
        "ffmpeg", "-y", "-v", "error", "-i", src_mp3,
        "-af", af, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", dst_wav,
    ]
    subprocess.run(cmd, check=True, capture_output=True, timeout=120)
    return ffprobe_duration(dst_wav)


def load_report():
    if os.path.exists(REPORT_FILE):
        try:
            with open(REPORT_FILE, encoding="utf-8") as f:
                return {int(k): v for k, v in json.load(f).items()}
        except Exception:
            return {}
    return {}


def save_report(report):
    with open(REPORT_FILE, "w", encoding="utf-8") as f:
        json.dump({str(k): report[k] for k in sorted(report)}, f, indent=2, ensure_ascii=False)


def process_segment(idx):
    start, end, text = SEGMENTS[idx]
    target = end - start
    margin = min(0.10, target * 0.015)
    eff_target = target - margin
    tag = f"seg{idx:03d}"
    raw = os.path.join(SEG_DIR, f"{tag}.mp3")
    s1 = os.path.join(SEG_DIR, f"{tag}_speed1.mp3")
    wav = os.path.join(WAV_DIR, f"{tag}.wav")

    # fast path: already fitted successfully in a previous run
    prev = load_report().get(idx)
    if prev and "error" not in prev and os.path.exists(wav):
        d = ffprobe_duration(wav)
        if d > 0.5 and d <= target + 0.05:
            log(f"{tag}: cached fit {d:.3f}s (skip)")
            return prev

    rec = {
        "idx": idx, "start": start, "end": end, "target": round(target, 3),
        "text": text,
    }

    # ---- Phase 1: base synthesis at speed 1.0 (skip if already done) ----
    if is_valid_mp3(s1):
        gen = ffprobe_duration(s1)
    else:
        ok = synthesize(text, 1.0, s1, tag)
        if not ok:
            rec["error"] = "phase1 synthesis failed"
            log(f"{tag}: FAILED phase-1 synthesis")
            return rec
        gen = ffprobe_duration(s1)

    rec["gen1_duration"] = round(gen, 3)
    chosen_mp3 = s1
    chosen_speed = 1.0
    atempo = 1.0

    # ---- Phase 2: fit to window ----
    if gen <= eff_target:
        rec["action"] = "as-is (fits; natural pacing, trailing silence)"
    else:
        factor = gen / eff_target
        if factor <= 1.15:
            atempo = gen / eff_target
            rec["action"] = f"atempo {atempo:.4f} (slightly long)"
        else:
            # regenerate with official prosody.speed (0.5-2.0) for natural pacing
            need = min(round(factor, 2), 2.0)
            ok = synthesize(text, need, raw, f"{tag}-r{need}")
            if ok:
                gen2 = ffprobe_duration(raw)
                rec["regen_speed"] = need
                rec["gen2_duration"] = round(gen2, 3)
                chosen_mp3, chosen_speed = raw, need
                if gen2 <= eff_target:
                    rec["action"] = f"regenerated at prosody.speed={need}"
                else:
                    atempo = gen2 / eff_target
                    if atempo <= 2.0:
                        rec["action"] = f"regen speed={need} + residual atempo {atempo:.4f}"
                    else:
                        rec["error"] = "cannot fit even at max speed"
                        log(f"{tag}: CANNOT FIT")
                        return rec
            else:
                atempo = gen / eff_target
                rec["action"] = f"regen failed; fallback atempo {atempo:.4f}"
                if atempo > 2.0:
                    atempo = 2.0

    final_dur = fit_wav(chosen_mp3, wav, atempo)
    rec["prosody_speed"] = chosen_speed
    rec["atempo"] = round(atempo, 6) if atempo > 1.0005 else 1.0
    rec["final_duration"] = round(final_dur, 3)
    rec["fits"] = final_dur <= target + 0.02
    log(
        f"{tag}: target={target:.3f}s gen={rec['gen1_duration']:.3f}s "
        f"final={final_dur:.3f}s [{rec['action']}]"
    )
    return rec


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    idxs = [int(x) for x in only.split(",")] if only else list(range(len(SEGMENTS)))
    log(f"=== generation started for {len(idxs)} segments (workers={MAX_WORKERS}) ===")
    results = {}
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futs = {ex.submit(process_segment, i): i for i in idxs}
        done = 0
        for fut in as_completed(futs):
            i = futs[fut]
            try:
                results[i] = fut.result()
            except Exception as e:
                results[i] = {"idx": i, "error": f"{type(e).__name__}: {e}"}
                log(f"seg{i:03d}: EXCEPTION {e}")
            done += 1
            log(f"--- progress: {done}/{len(idxs)} done ---")

    # merge with existing report if present
    report = load_report()
    report.update(results)
    save_report(report)

    bad = [i for i, r in report.items() if "error" in r]
    log(f"=== done. ok={len(report) - len(bad)} failed={len(bad)} {('failed idx: ' + str(bad)) if bad else ''} ===")


if __name__ == "__main__":
    main()
