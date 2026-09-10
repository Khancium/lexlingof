function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return bufferToHex(digest);
}

// The browser-recorded mimeType (varies by browser: webm/opus in
// Chrome/Firefox, mp4/aac in Safari) needs to be one the backend's
// upload-url ALLOWED_MIME_TYPES list actually accepts.
const SUPPORTED_MIME_TYPES = ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"];

export function pickRecorderMimeType(): string {
  for (const type of SUPPORTED_MIME_TYPES) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "audio/webm";
}

// These are corpus voice recordings (single speaker, no music), not
// general-purpose audio -- a bitrate tuned for clear speech is a small
// fraction of a codec's music-quality default (webm/ogg's Opus commonly
// defaults to 128kbps in Chrome) with no perceptible loss for transcription
// or playback review. wav is excluded -- it's uncompressed PCM, so
// audioBitsPerSecond doesn't apply and is only ever a fallback when neither
// codec below is supported at all.
const RECORDING_BITS_PER_SECOND: Record<string, number> = {
  "audio/webm": 24000,
  "audio/ogg": 24000,
  // AAC (Safari's mp4 container) needs a bit more headroom than Opus to
  // stay clear at low bitrates.
  "audio/mp4": 40000,
};

export function recorderBitsPerSecond(mimeType: string): number | undefined {
  return RECORDING_BITS_PER_SECOND[mimeType];
}

export function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}
