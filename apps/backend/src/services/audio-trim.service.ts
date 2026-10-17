import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import ffmpeg from "fluent-ffmpeg";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

// Below this level, a run of near-silence at the very start/end of a clip is
// trimmed; a pause inside the recording (between words, mid-sentence) is left
// alone since it isn't at either edge.
const SILENCE_THRESHOLD_DB = "-40dB";
const MIN_SILENCE_RUN_SECONDS = 0.3;
// silenceremove's detected boundary sits right at the amplitude threshold
// crossing, which is tighter than where a listener actually perceives speech
// starting/ending -- trimming exactly to that boundary was clipping the soft
// onset/decay of real words (a quiet consonant, a trailing vowel). Padding
// back a fixed amount of true silence on each side after the tight trim
// fixes that without having to fight with the detection threshold itself.
const EDGE_PADDING_SECONDS = 0.6;
// Guards against a clip that's almost entirely silence (or a false positive
// on a very quiet real recording) getting trimmed down to effectively
// nothing -- if the result would be shorter than this, the original is kept
// untouched instead. Smaller than the padding added back on each side (which
// alone totals 1200ms) so this only fires when the content between the pads
// is itself negligible, not because the padding exists.
const MIN_RESULT_DURATION_MS = 1200 + 200;

export type TrimResult = { buffer: Buffer; durationMs: number; trimmed: boolean };

/**
 * Detects and clips long silence at the very start and end of a recording
 * (ffmpeg's silenceremove filter), then pads exactly EDGE_PADDING_SECONDS of
 * true silence back onto each end (adelay prepends, apad appends) so the
 * trim never sits flush against the first/last audible moment. Re-measures
 * the actual duration of the result rather than trusting anything
 * client-reported. Never throws -- any failure (corrupt input, ffmpeg
 * missing, trimmed-to-nothing) falls back to the original buffer untouched,
 * so a processing hiccup never blocks an upload.
 */
export async function trimSilence(input: Buffer, format: string): Promise<TrimResult> {
  const workDir = path.join(tmpdir(), `lexlingo-trim-${randomUUID()}`);
  const inPath = path.join(workDir, `in.${format}`);
  const outPath = path.join(workDir, `out.${format}`);

  try {
    await mkdir(workDir, { recursive: true });
    await writeFile(inPath, input);

    // adelay only prepends silence -- there's no version-portable
    // duration-based "pad the end" option (apad's pad_dur/whole_dur aren't
    // available on every ffmpeg build this might run on, pad_len/whole_len
    // need a sample count we don't know ahead of time). Reversing the audio,
    // prepending the same delay again, then reversing back turns a second
    // adelay into an append -- the standard portable trick for padding both
    // ends with just adelay+areverse.
    const paddingMs = Math.round(EDGE_PADDING_SECONDS * 1000);
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inPath)
        .audioFilters(
          `silenceremove=start_periods=1:start_duration=${MIN_SILENCE_RUN_SECONDS}:start_threshold=${SILENCE_THRESHOLD_DB}:` +
            `stop_periods=1:stop_duration=${MIN_SILENCE_RUN_SECONDS}:stop_threshold=${SILENCE_THRESHOLD_DB}:detection=peak,` +
            `adelay=${paddingMs},areverse,adelay=${paddingMs},areverse`,
        )
        .on("error", reject)
        .on("end", () => resolve())
        .save(outPath);
    });

    const [trimmedBuffer, trimmedDurationMs] = await Promise.all([readFile(outPath), probeDurationMs(outPath)]);

    if (trimmedDurationMs < MIN_RESULT_DURATION_MS) {
      const originalDurationMs = await probeDurationMs(inPath);
      return { buffer: input, durationMs: originalDurationMs, trimmed: false };
    }

    return { buffer: trimmedBuffer, durationMs: trimmedDurationMs, trimmed: true };
  } catch (err) {
    console.error("[audio-trim] silence trim failed, keeping original audio:", err);
    const originalDurationMs = await probeDurationMs(inPath).catch(() => 0);
    return { buffer: input, durationMs: originalDurationMs, trimmed: false };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function probeDurationMs(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const seconds = data.format.duration;
      if (seconds == null) return reject(new Error("ffprobe returned no duration"));
      resolve(Math.round(seconds * 1000));
    });
  });
}
