# -*- coding: utf-8 -*-
"""
Assemble the final single voice-over track.

1. Verify all 57 fitted WAVs exist (44.1kHz mono s16).
2. Build master timeline: exactly 412.280s of digital silence, then place every
   segment at its EXACT start frame. Gaps (incl. 353.280->364.639) stay silent.
   Hard boundary: a segment can never write past its end timestamp frame.
3. Loudness-normalize to -16 LUFS program loudness: every segment runs through
   an identical chain: volume=<gain>dB -> 4x oversampled alimiter (true-peak
   safety at -1.5 dBTP) -> back to 44.1kHz. alimiter lookahead latency (132
   samples) is compensated by placing at offset-132, so speech lands exactly
   on its timestamp.
4. Export final MP3: 44.1kHz, 128kbps CBR, mono.
5. Write fit-report.json for the delivery page.
"""
import json
import os
import subprocess
import sys
import wave

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from segments import SEGMENTS, TOTAL_DURATION, SAMPLE_RATE

BASE = os.path.dirname(os.path.abspath(__file__))
WAV_DIR = os.path.join(BASE, "wav")
PROC_DIR = os.path.join(BASE, "proc")
MASTER_WAV = os.path.join(BASE, "master.wav")
MASTER_NORM = os.path.join(BASE, "master_norm.wav")
FINAL_MP3 = os.path.join(BASE, "voiceover_final.mp3")
REPORT_FILE = os.path.join(BASE, "report.json")
os.makedirs(PROC_DIR, exist_ok=True)

TOTAL_FRAMES = int(round(TOTAL_DURATION * SAMPLE_RATE))  # 18,181,548
LIMITER_DELAY = 132  # samples @44.1kHz: measured lookahead of the gain+limit chain
TAME_IDX = 40  # segment with outlier plosive transients (pre-tamed separately)


def die(msg):
    print(f"FATAL: {msg}")
    sys.exit(1)


def build_master(src_dir, delay_comp):
    """Place segments from src_dir into the master timeline. Returns (buffer, overlap_notes)."""
    buf = bytearray(TOTAL_FRAMES * 2)  # mono, 16-bit
    overlap_notes = []
    for i, (start, end, _text) in enumerate(SEGMENTS):
        wav_path = os.path.join(src_dir, f"seg{i:03d}.wav")
        if not os.path.exists(wav_path):
            die(f"missing wav for segment {i} in {src_dir}")
        with wave.open(wav_path, "rb") as w:
            assert w.getframerate() == SAMPLE_RATE and w.getnchannels() == 1 and w.getsampwidth() == 2, \
                f"seg{i:03d} format mismatch: {w.getframerate()}Hz {w.getnchannels()}ch {w.getsampwidth()*8}bit"
            frames = w.readframes(w.getnframes())
        off = int(round(start * SAMPLE_RATE)) - delay_comp  # compensate limiter lookahead
        if off < 0:
            off = 0
        limit = int(round(end * SAMPLE_RATE))  # boundary = next segment's start frame
        n = len(frames) // 2
        avail = limit - off
        if n > avail:
            cut_ms = (n - avail) / SAMPLE_RATE * 1000
            # allowed only if what we cut is the fitting safety-margin (silence)
            if cut_ms > 30:
                overlap_notes.append(f"seg{i:03d}: would clip {cut_ms:.1f}ms of audio")
            n = avail
        buf[off * 2 : (off + n) * 2] = frames[: n * 2]
    return buf, overlap_notes


def write_master(buf):
    with wave.open(MASTER_WAV, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(bytes(buf))


def measure_loudness(path):
    p = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "info", "-i", path,
         "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
        capture_output=True, text=True, timeout=300, stdin=subprocess.DEVNULL,
    )
    js = p.stderr[p.stderr.rfind("{"): p.stderr.rfind("}") + 1]
    m = json.loads(js)
    return float(m["input_i"]), float(m["input_tp"]), float(m["input_lra"])


def main():
    with open(REPORT_FILE, encoding="utf-8") as f:
        report = {int(k): v for k, v in json.load(f).items()}

    errors = [i for i, r in report.items() if "error" in r]
    if errors:
        die(f"segments with errors: {errors} — run generate.py for these first")

    missing = [i for i in range(len(SEGMENTS)) if i not in report]
    if missing:
        die(f"segments missing from report: {missing}")

    # ---- 1. build raw master (no gain) to measure program loudness ----
    buf, notes = build_master(WAV_DIR, 0)
    if notes:
        die("boundary violations detected:\n" + "\n".join(notes))
    write_master(buf)
    I, TP, LRA = measure_loudness(MASTER_WAV)
    gain = -16.0 - I
    if gain > 8.5:
        gain = 8.5
    if gain < 0:
        gain = 0.0
    gain = round(gain, 3)
    print(f"raw master: {TOTAL_FRAMES} frames = {TOTAL_FRAMES / SAMPLE_RATE:.3f}s | "
          f"I={I:.2f} LUFS, TP={TP:.2f} dBTP -> gain {gain:+.3f} dB + TP limiter (-1.5 dBTP, 4x oversampled)")

    # ---- 2. per-segment normalize chain (identical for every segment -> consistent voice) ----
    chain = (
        f"volume={gain}dB,aresample=176400,"
        "alimiter=limit=0.8414:attack=3:release=100:level=disabled,aresample=44100"
    )
    for i in range(len(SEGMENTS)):
        src = os.path.join(WAV_DIR, f"seg{i:03d}.wav")
        dst = os.path.join(PROC_DIR, f"seg{i:03d}.wav")
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", src,
             "-af", chain, "-c:a", "pcm_s16le", dst],
            check=True, timeout=120, stdin=subprocess.DEVNULL,
        )

    # ---- 3. rebuild master from processed segments (latency-compensated) ----
    buf, notes = build_master(PROC_DIR, LIMITER_DELAY)
    if notes:
        die("boundary violations detected:\n" + "\n".join(notes))
    write_master(buf)
    I2, TP2, _ = measure_loudness(MASTER_WAV)
    print(f"final master: I={I2:.2f} LUFS, TP={TP2:.2f} dBTP")

    # ---- 4. final MP3 export ----
    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", MASTER_WAV,
         "-codec:a", "libmp3lame", "-b:a", "128k", "-ar", "44100", FINAL_MP3],
        check=True, timeout=300, stdin=subprocess.DEVNULL,
    )
    dur = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration,size",
         "-of", "default=nw=1", FINAL_MP3],
        capture_output=True, text=True, timeout=30,
    ).stdout
    print("final MP3:", dur.strip())

    # ---- 5. page report ----
    page = {
        "total_duration": TOTAL_DURATION,
        "sample_rate": SAMPLE_RATE,
        "bitrate_kbps": 128,
        "loudness_gain_db": gain,
        "input_lufs": I,
        "final_lufs": I2,
        "final_tp_dbtp": TP2,
        "segments": [
            {
                "idx": i,
                "start": s,
                "end": e,
                "target": round(e - s, 3),
                "final_duration": report[i].get("final_duration"),
                "prosody_speed": report[i].get("prosody_speed", 1.0),
                "atempo": report[i].get("atempo", 1.0),
                "action": report[i].get("action", ""),
                "text": t,
            }
            for i, (s, e, t) in enumerate(SEGMENTS)
        ],
    }
    with open(os.path.join(BASE, "fit-report.json"), "w", encoding="utf-8") as f:
        json.dump(page, f, indent=2, ensure_ascii=False)
    print("fit-report.json written")
    print("ASSEMBLY OK")


if __name__ == "__main__":
    main()
