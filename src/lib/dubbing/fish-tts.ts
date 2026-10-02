/**
 * Fish Audio TTS client — exact same request shape as the original
 * voiceover run (model s2.1-pro-free, temperature 0.7, top_p 0.7, MP3
 * 44.1kHz 128kbps, normalize, latency normal).
 */

import { FISH_CONFIG, FIT_RULES } from "./types";

export interface TTSParams {
  apiKey: string;
  referenceId: string;
  model?: string;
  text: string;
  prosodySpeed: number;
}

export async function callFishTTS(
  p: TTSParams,
  timeoutMs = 180000
): Promise<Buffer> {
  const res = await fetch("https://api.fish.audio/v1/tts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${p.apiKey}`,
      "Content-Type": "application/json",
      model: p.model ?? FISH_CONFIG.model,
    },
    body: JSON.stringify({
      text: p.text,
      reference_id: p.referenceId,
      temperature: FISH_CONFIG.temperature,
      top_p: FISH_CONFIG.topP,
      prosody: { speed: p.prosodySpeed, volume: 0, normalize_loudness: true },
      chunk_length: FISH_CONFIG.chunkLength,
      normalize: FISH_CONFIG.normalize,
      format: FISH_CONFIG.format,
      sample_rate: FISH_CONFIG.sampleRate,
      mp3_bitrate: FISH_CONFIG.mp3Bitrate,
      latency: FISH_CONFIG.latency,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`Fish Audio HTTP ${res.status}: ${body}`);
  }

  const ct = res.headers.get("content-type") ?? "";
  const buf = Buffer.from(await res.arrayBuffer());
  if (!ct.includes("audio") || buf.length < 2048) {
    throw new Error(
      `Fish Audio: unexpected response (${ct || "no type"}, ${buf.length}B) ${buf.toString("utf8", 0, 120)}`
    );
  }
  return buf;
}

/**
 * Synthesize with retries + exponential backoff (same retry spirit as the
 * original generate.py). Returns the number of attempts consumed.
 */
export async function synthesizeToFile(
  params: TTSParams,
  outPath: string,
  tag: string,
  log: (msg: string) => void,
  onAttempt?: (attempt: number) => Promise<void>
): Promise<number> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= FIT_RULES.maxTries; attempt++) {
    try {
      const buf = await callFishTTS(params);
      const { writeFile } = await import("fs/promises");
      await writeFile(outPath, buf);
      return attempt;
    } catch (e) {
      lastErr = e;
      const wait = Math.min(3000 * 2 ** (attempt - 1), 30000);
      log(
        `${tag} attempt ${attempt}/${FIT_RULES.maxTries} failed: ${(e as Error).message} — retry in ${wait / 1000}s`
      );
      if (onAttempt) {
        try {
          await onAttempt(attempt);
        } catch {
          /* keep going */
        }
      }
      if (attempt < FIT_RULES.maxTries) {
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
