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

export function extensionForMimeType(mimeType: string): string {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}
