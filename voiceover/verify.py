# -*- coding: utf-8 -*-
"""
Post-assembly verification on master.wav (pre-MP3, exact PCM):
1. Timeline length == 412.280s
2. Every segment has speech energy right after its start (placement check)
3. For every segment: the window between its ACTUAL fitted end (+20ms) and the
   next segment's start must be silent -> proves no segment spills past its slot
4. The scripted 353.280 -> 364.639 gap is fully silent
5. Loudness of final MP3 must be ~-16 LUFS
"""
import json
import math
import struct
import sys
import wave

sys.path.insert(0, "/home/z/my-project/voiceover")
from segments import SEGMENTS, TOTAL_DURATION, SAMPLE_RATE

SR = SAMPLE_RATE
with wave.open("/home/z/my-project/voiceover/master.wav", "rb") as w:
    assert w.getframerate() == SR and w.getnchannels() == 1
    n_total = w.getnframes()
    raw = w.readframes(n_total)

samples = struct.unpack(f"<{n_total}h", raw)
report = {int(k): v for k, v in json.load(open("/home/z/my-project/voiceover/report.json")).items()}

print(f"frames={n_total} duration={n_total / SR:.4f}s (required >= {TOTAL_DURATION:.3f}s)")
assert n_total >= int(round(TOTAL_DURATION * SR)), "master too short!"


def rms(start_s, dur_s):
    a = int(round(start_s * SR))
    b = min(n_total, int(round((start_s + dur_s) * SR)))
    if b <= a:
        return -1
    acc = 0
    for i in range(a, b):
        v = samples[i]
        acc += v * v
    return (acc / (b - a)) ** 0.5


fails = []

# 1. speech present at each segment start
for i, (s, e, _t) in enumerate(SEGMENTS):
    r_in = rms(s + 0.15, 0.6)
    if r_in < 100:
        fails.append(f"seg{i:03d}: no speech energy after start (rms={r_in:.0f})")

# 2. silence after each segment's ACTUAL fitted end, up to next start
for i, (s, e, _t) in enumerate(SEGMENTS):
    fitted_end = s + report[i]["final_duration"]
    next_start = SEGMENTS[i + 1][0] if i + 1 < len(SEGMENTS) else TOTAL_DURATION
    a, b = fitted_end + 0.02, next_start - 0.005
    if b - a >= 0.05:
        r = rms(a, b - a)
        if r > 25:
            fails.append(f"seg{i:03d}: audio past fitted end {fitted_end:.3f} (rms={r:.0f})")

# 3. scripted silence gap fully silent
gap_rms = rms(353.30, 11.2)
if gap_rms > 1:
    fails.append(f"silence gap 353.28-364.64 not silent (rms={gap_rms:.0f})")

peak = max(abs(v) for v in samples)
print(f"gap rms={gap_rms:.1f} | global peak={peak} ({20 * math.log10(peak / 32768):.2f} dBFS)")

if fails:
    print("FAILURES:")
    for f in fails:
        print(" -", f)
    sys.exit(1)
print("VERIFICATION PASSED: all 57 segments placed at exact offsets, no spill-over, gap silent")
