/**
 * ffmpeg/ffprobe helpers (Node child_process, no shell).
 */

import { execFile } from "child_process";

export function run(
  cmd: string,
  args: string[],
  timeoutMs = 300000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(
            new Error(
              `${cmd} failed: ${String(stderr).slice(-400) || err.message}`
            )
          );
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

/** Probe media duration in ms. Throws on failure. */
export async function probeDurationMs(path: string): Promise<number> {
  const { stdout } = await run(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=nw=1:nk=1",
      path,
    ],
    60000
  );
  const d = parseFloat(stdout.trim());
  if (!isFinite(d) || d <= 0) {
    throw new Error(`ffprobe: invalid duration for ${path}`);
  }
  return Math.round(d * 1000);
}

/** Non-throwing probe (returns 0 on failure). */
export async function tryProbeMs(path: string): Promise<number> {
  try {
    return await probeDurationMs(path);
  } catch {
    return 0;
  }
}
