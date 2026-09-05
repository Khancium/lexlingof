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

type ContributionModule = (typeof contributionModule.enumValues)[number];

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

  async generateAudioPlayUrl(storageKey: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: storageKey,
    });

    return getSignedUrl(r2, command, { expiresIn: PLAY_URL_EXPIRY_SECONDS });
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
