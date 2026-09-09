import type { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

import type { contributionModule } from "../db/schema.js";
import { HttpError } from "../utils/http-error.js";

type ContributionModule = (typeof contributionModule.enumValues)[number];

const MAX_FETCHED_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
const FETCH_IMAGE_TIMEOUT_MS = 15_000;

const r2 = new S3Client({
  endpoint: process.env.R2_ENDPOINT,
  region: "auto",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const AUDIO_BUCKET = process.env.R2_AUDIO_BUCKET!;
const EXPORTS_BUCKET = process.env.R2_EXPORTS_BUCKET!;
const IMAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET!;

/** Module 1 (WORD) uploads get a short 15-minute window; every other module gets 2 hours. */
const WORD_UPLOAD_EXPIRY_SECONDS = 900;
const DEFAULT_UPLOAD_EXPIRY_SECONDS = 7200;
const PLAY_URL_EXPIRY_SECONDS = 3600;
const EXPORT_URL_EXPIRY_SECONDS = 86400;

/**
 * Handles all file storage for Lexlingo. Audio files live in Cloudflare R2;
 * scene and concept images live in Supabase Storage.
 */
class StorageService {
  /* ---------------------------------------------------------------------- */
  /*                          Audio — Cloudflare R2                         */
  /* ---------------------------------------------------------------------- */

  async generateAudioUploadUrl(
    audioFileId: string,
    storageKey: string,
    mimeType: string,
    moduleType: ContributionModule,
  ): Promise<{ uploadUrl: string; expiresAt: Date }> {
    const expiresIn = moduleType === "WORD" ? WORD_UPLOAD_EXPIRY_SECONDS : DEFAULT_UPLOAD_EXPIRY_SECONDS;

    const command = new PutObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: storageKey,
      ContentType: mimeType,
      Metadata: { audioFileId },
    });

    const uploadUrl = await getSignedUrl(r2, command, { expiresIn });
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    return { uploadUrl, expiresAt };
  }

  /** Used by the submission-buffer worker, which already holds the bytes server-side and skips the presigned-URL round trip entirely. */
  async uploadAudioBuffer(storageKey: string, buffer: Buffer, mimeType: string): Promise<void> {
    await r2.send(
      new PutObjectCommand({
        Bucket: AUDIO_BUCKET,
        Key: storageKey,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
  }

  async generateAudioPlayUrl(storageKey: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: storageKey,
    });

    return getSignedUrl(r2, command, { expiresIn: PLAY_URL_EXPIRY_SECONDS });
  }

  /** Same object as generateAudioPlayUrl, but forces a browser download (via Content-Disposition) instead of inline playback -- used by the admin contributions download button. */
  async generateAudioDownloadUrl(storageKey: string, filename: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: storageKey,
      ResponseContentDisposition: `attachment; filename="${filename.replace(/"/g, "")}"`,
    });

    return getSignedUrl(r2, command, { expiresIn: PLAY_URL_EXPIRY_SECONDS });
  }

  /**
   * Raw object body stream (not a presigned URL) -- used server-side to fold
   * several audio files into one zip without round-tripping them through the
   * browser first. The SDK types Body as Readable | ReadableStream | Blob,
   * but running in Node it's always a Readable at runtime.
   */
  async getAudioObjectStream(storageKey: string): Promise<Readable> {
    const command = new GetObjectCommand({ Bucket: AUDIO_BUCKET, Key: storageKey });
    const response = await r2.send(command);
    return response.Body as Readable;
  }

  async deleteAudioFile(storageKey: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: storageKey,
    });

    await r2.send(command);
  }

  async generateExportUrl(storageKey: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: EXPORTS_BUCKET,
      Key: storageKey,
    });

    return getSignedUrl(r2, command, { expiresIn: EXPORT_URL_EXPIRY_SECONDS });
  }

  /* ---------------------------------------------------------------------- */
  /*                        Images — Supabase Storage                       */
  /* ---------------------------------------------------------------------- */

  /**
   * Concept/scene images are shown as small thumbnails (grids, review
   * cards) but were previously uploaded and served at whatever resolution
   * the contributor's camera produced -- often several MB. Re-encoding to a
   * capped JPEG here means every future upload is thumbnail-appropriate at
   * the source, which is the main fix for "images take forever to load"
   * (existing already-uploaded originals are unaffected by this).
   */
  private static readonly IMAGE_MAX_DIMENSION = 1600;
  private static readonly IMAGE_JPEG_QUALITY = 82;

  async uploadSceneImage(
    fileBuffer: Buffer,
    filename: string,
  ): Promise<{ path: string; publicUrl: string; mimeType: string; fileSizeBytes: number }> {
    const resized = await sharp(fileBuffer)
      .rotate() // apply EXIF orientation before stripping metadata below
      .resize({
        width: StorageService.IMAGE_MAX_DIMENSION,
        height: StorageService.IMAGE_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: StorageService.IMAGE_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    const jpegFilename = filename.replace(/\.[^./]+$/, "") + ".jpg";

    const { data, error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(jpegFilename, resized, { contentType: "image/jpeg" });

    if (error) {
      throw error;
    }

    const publicUrl = this.getImagePublicUrl(data.path);

    return { path: data.path, publicUrl, mimeType: "image/jpeg", fileSizeBytes: resized.byteLength };
  }

  /**
   * Downloads a third-party image (admin-supplied URL) so it can be re-hosted
   * through the same uploadSceneImage() path as a direct file upload -- this
   * keeps concept/scene images on our own CDN instead of hotlinking, and
   * means a source link going dead later doesn't break the app.
   */
  async fetchImageFromUrl(url: string): Promise<{ buffer: Buffer; filename: string }> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new HttpError(400, "INVALID_URL", "Not a valid URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new HttpError(400, "INVALID_URL", "Only http:// and https:// URLs are supported");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_IMAGE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(parsed, { signal: controller.signal });
    } catch {
      throw new HttpError(400, "FETCH_FAILED", "Could not reach that URL");
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new HttpError(400, "FETCH_FAILED", `URL returned HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      throw new HttpError(400, "INVALID_FILE_TYPE", "That URL did not return an image");
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_FETCHED_IMAGE_BYTES) {
      throw new HttpError(400, "FILE_TOO_LARGE", `Image exceeds the ${MAX_FETCHED_IMAGE_BYTES} byte limit`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_FETCHED_IMAGE_BYTES) {
      throw new HttpError(400, "FILE_TOO_LARGE", `Image exceeds the ${MAX_FETCHED_IMAGE_BYTES} byte limit`);
    }

    const filename = decodeURIComponent(parsed.pathname.split("/").pop() || "image") || "image";
    return { buffer, filename };
  }

  private static readonly AVATAR_MAX_DIMENSION = 512;
  private static readonly AVATAR_JPEG_QUALITY = 85;

  async uploadAvatarImage(fileBuffer: Buffer, filename: string): Promise<{ path: string; publicUrl: string }> {
    const resized = await sharp(fileBuffer)
      .rotate()
      .resize({
        width: StorageService.AVATAR_MAX_DIMENSION,
        height: StorageService.AVATAR_MAX_DIMENSION,
        fit: "cover",
      })
      .jpeg({ quality: StorageService.AVATAR_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();

    const jpegFilename = filename.replace(/\.[^./]+$/, "") + ".jpg";

    const { data, error } = await supabase.storage
      .from(IMAGE_BUCKET)
      .upload(jpegFilename, resized, { contentType: "image/jpeg", upsert: true });

    if (error) {
      throw error;
    }

    return { path: data.path, publicUrl: this.getImagePublicUrl(data.path) };
  }

  getImagePublicUrl(path: string): string {
    const {
      data: { publicUrl },
    } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);

    return publicUrl;
  }

  async deleteImage(path: string): Promise<void> {
    const { error } = await supabase.storage.from(IMAGE_BUCKET).remove([path]);

    if (error) {
      throw error;
    }
  }
}

export const storageService = new StorageService();
