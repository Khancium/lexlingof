import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/*                                    Enums                                   */
/* -------------------------------------------------------------------------- */

export const userRole = pgEnum("user_role", ["super_admin", "admin", "contributor"]);

export const contributionModule = pgEnum("contribution_module", [
  "WORD",
  "TRANSCRIPTION",
  "TRANSLATION",
  "SCENE",
]);

export const contributionStatus = pgEnum("contribution_status", [
  "draft",
  "pending",
  "under_review",
  "verified",
  "needs_correction",
  "rejected",
  "withdrawn",
]);

export const reviewDecision = pgEnum("review_decision", ["valid", "needs_correction", "invalid"]);

export const audioProcessingStatus = pgEnum("audio_processing_status", [
  "pending_upload",
  "uploaded",
  "processing",
  "ready",
  "failed",
  "quarantined",
]);

export const audioFormat = pgEnum("audio_format", [
  "wav",
  "mp3",
  "m4a",
  "aac",
  "opus",
  "webm",
  "flac",
  "ogg",
]);

export const contributorLevel = pgEnum("contributor_level", [
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
]);

export const badgeTriggerType = pgEnum("badge_trigger_type", [
  "contribution_count",
  "verified_count",
  "streak_days",
  "module_completion",
  "level_reached",
  "review_count",
  "manual",
]);

export const consentStatus = pgEnum("consent_status", [
  "granted",
  "withdrawn",
  "pending",
  "expired",
]);

export const dataAccessLevel = pgEnum("data_access_level", [
  "public",
  "community",
  "research",
  "restricted",
  "private",
]);

export const sceneDifficulty = pgEnum("scene_difficulty", ["easy", "medium", "hard", "expert"]);

export const streakStatus = pgEnum("streak_status", ["active", "broken", "grace"]);

export const notificationChannel = pgEnum("notification_channel", ["in_app", "email", "push"]);

export const notificationStatus = pgEnum("notification_status", [
  "pending",
  "sent",
  "delivered",
  "failed",
  "read",
]);

export const exportFormat = pgEnum("export_format", ["json", "csv", "jsonl", "audio_archive"]);

export const exportStatus = pgEnum("export_status", [
  "pending",
  "processing",
  "completed",
  "failed",
  "expired",
]);

/* -------------------------------------------------------------------------- */
/*                             Identity and access                            */
/* -------------------------------------------------------------------------- */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    passwordHash: text("password_hash"),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    role: userRole("role").default("contributor").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    isSuspended: boolean("is_suspended").default(false).notNull(),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedReason: text("suspended_reason"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    timezone: text("timezone").default("UTC").notNull(),
    locale: text("locale").default("en").notNull(),
    biography: text("biography"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_users_email_active")
      .on(t.email)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  deviceId: text("device_id"),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

/** Push notification device registrations. */
export const deviceTokens = pgTable(
  "device_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    platform: text("platform").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("ix_device_tokens_user").on(t.userId)],
);

export const permissions = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  description: text("description").notNull(),
  module: text("module").notNull(),
  action: text("action").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    role: userRole("role").notNull(),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.role, t.permissionId] })],
);

export const userAdditionalPermissions = pgTable(
  "user_additional_permissions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    grantedBy: uuid("granted_by").references(() => users.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.permissionId] })],
);

/* -------------------------------------------------------------------------- */
/*                           Languages and taxonomy                           */
/* -------------------------------------------------------------------------- */

export const languages = pgTable("languages", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** BCP-47 tag: ps, ur, en. */
  code: text("code").notNull().unique(),
  iso6393: text("iso_639_3").unique(),
  nameEnglish: text("name_english").notNull(),
  nameNative: text("name_native").notNull(),
  scriptCode: text("script_code"),
  textDirection: text("text_direction").default("ltr").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const dialects = pgTable(
  "dialects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    languageId: uuid("language_id")
      .notNull()
      .references(() => languages.id),
    code: text("code").notNull(),
    nameEnglish: text("name_english").notNull(),
    nameNative: text("name_native"),
    region: text("region"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uq_dialects_language_code").on(t.languageId, t.code)],
);

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  nameEnglish: text("name_english").notNull(),
  icon: text("icon"),
  parentId: uuid("parent_id").references((): AnyPgColumn => categories.id),
  sortOrder: integer("sort_order").default(0).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const concepts = pgTable(
  "concepts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    slug: text("slug").notNull(),
    labelEnglish: text("label_english").notNull(),
    description: text("description"),
    difficulty: integer("difficulty").default(1).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_concepts_slug_active")
      .on(t.slug)
      .where(sql`${t.deletedAt} is null`),
    check("ck_concepts_difficulty_range", sql`${t.difficulty} between 1 and 5`),
  ],
);

/** Concept imagery held in Supabase Storage. */
export const conceptMedia = pgTable("concept_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  conceptId: uuid("concept_id")
    .notNull()
    .references(() => concepts.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  publicUrl: text("public_url"),
  mimeType: text("mime_type").notNull(),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  isPrimary: boolean("is_primary").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sentences = pgTable(
  "sentences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    englishText: text("english_text").notNull(),
    categoryId: uuid("category_id").references(() => categories.id),
    difficulty: integer("difficulty").default(1).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    usageCount: integer("usage_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("ix_sentences_fts").using("gin", sql`to_tsvector('english', ${t.englishText})`),
    check("ck_sentences_difficulty_range", sql`${t.difficulty} between 1 and 5`),
  ],
);

export const scenes = pgTable(
  "scenes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    difficulty: sceneDifficulty("difficulty").default("medium").notNull(),
    estimatedDurationSeconds: integer("estimated_duration_seconds"),
    isActive: boolean("is_active").default(true).notNull(),
    isDaily: boolean("is_daily").default(false).notNull(),
    dailyDate: date("daily_date"),
    version: integer("version").default(1).notNull(),
    conceptCount: integer("concept_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_scenes_slug_active")
      .on(t.slug)
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** Scene imagery held in Supabase Storage. */
export const sceneMedia = pgTable("scene_media", {
  id: uuid("id").primaryKey().defaultRandom(),
  sceneId: uuid("scene_id")
    .notNull()
    .references(() => scenes.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  publicUrl: text("public_url"),
  mimeType: text("mime_type").notNull(),
  isPrimary: boolean("is_primary").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * ADMIN ONLY — never expose to contributors.
 *
 * Records concepts visible in a scene image. `annotatedPresence` is set ONLY by
 * human annotators, never automatically.
 */
export const sceneConcepts = pgTable(
  "scene_concepts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sceneId: uuid("scene_id")
      .notNull()
      .references(() => scenes.id, { onDelete: "cascade" }),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    importance: integer("importance").default(1).notNull(),
    /** NEVER set automatically — human annotation only. */
    annotatedPresence: boolean("annotated_presence"),
    annotationSource: text("annotation_source"),
    annotationDate: timestamp("annotation_date", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_scene_concepts_scene_concept").on(t.sceneId, t.conceptId),
    check("ck_scene_concepts_importance_range", sql`${t.importance} between 1 and 5`),
  ],
);

/* -------------------------------------------------------------------------- */
/*                                Audio storage                               */
/* -------------------------------------------------------------------------- */

/** Physical audio objects in R2. Shared by all four modules. */
export const audioFiles = pgTable(
  "audio_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** R2 object key. */
    storageKey: text("storage_key").notNull().unique(),
    storageBucket: text("storage_bucket").default("lexlingo-audio").notNull(),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type").notNull(),
    format: audioFormat("format").notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
    /** Extracted by the background worker after upload. */
    durationMs: integer("duration_ms"),
    sampleRateHz: integer("sample_rate_hz"),
    channels: smallint("channels"),
    checksumSha256: text("checksum_sha256").notNull(),
    processingStatus: audioProcessingStatus("processing_status")
      .default("pending_upload")
      .notNull(),
    processingError: text("processing_error"),
    processingCompletedAt: timestamp("processing_completed_at", { withTimezone: true }),
    normalizedStorageKey: text("normalized_storage_key"),
    waveformStorageKey: text("waveform_storage_key"),
    virusScanStatus: text("virus_scan_status").default("pending").notNull(),
    virusScanAt: timestamp("virus_scan_at", { withTimezone: true }),
    cdnUrl: text("cdn_url"),
    accessLevel: dataAccessLevel("access_level").default("public").notNull(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    uploadIp: text("upload_ip"),
    uploadUserAgent: text("upload_user_agent"),
    uploadDeviceId: text("upload_device_id"),
    uploadAppVersion: text("upload_app_version"),
    moduleType: contributionModule("module_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletionScheduledAt: timestamp("deletion_scheduled_at", { withTimezone: true }),
  },
  (t) => [
    index("ix_audio_files_uploaded_by").on(t.uploadedBy),
    index("ix_audio_files_processing_status").on(t.processingStatus),
    index("ix_audio_files_checksum").on(t.checksumSha256),
  ],
);

/* -------------------------------------------------------------------------- */
/*                        Module 1 — word recordings                          */
/* -------------------------------------------------------------------------- */

/**
 * Module 1 word recordings.
 *
 * The 3-second cap (`ck_word_recording_max_duration`) applies to THIS TABLE ONLY.
 * NEVER apply a duration limit to audio_uploads, translations or
 * scene_contributions — those modules accept audio of any length.
 */
export const wordRecordings = pgTable(
  "word_recordings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Set after the parent contribution row is created. */
    contributionId: uuid("contribution_id").references((): AnyPgColumn => contributions.id),
    conceptId: uuid("concept_id")
      .notNull()
      .references(() => concepts.id),
    audioFileId: uuid("audio_file_id")
      .notNull()
      .references(() => audioFiles.id),
    nativeWord: text("native_word"),
    romanization: text("romanization"),
    ipa: text("ipa"),
    synonymIndex: smallint("synonym_index").default(1).notNull(),
    takeIndex: smallint("take_index").default(1).notNull(),
    durationMs: integer("duration_ms").notNull(),
    isCurrent: boolean("is_current").default(true).notNull(),
    supersededBy: uuid("superseded_by").references((): AnyPgColumn => wordRecordings.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("uq_word_recordings_take")
      .on(t.contributionId, t.conceptId, t.synonymIndex, t.takeIndex)
      .where(sql`${t.deletedAt} is null`),
    /** Module 1 ONLY. 3-second limit. NEVER apply to other tables. */
    check("ck_word_recording_max_duration", sql`${t.durationMs} <= 3000`),
    check("ck_word_recording_min_duration", sql`${t.durationMs} > 0`),
    check("ck_word_recording_synonym_index", sql`${t.synonymIndex} between 1 and 3`),
    check("ck_word_recording_take_index", sql`${t.takeIndex} between 1 and 3`),
  ],
);

/* -------------------------------------------------------------------------- */
/*                    Module 2 — audio uploads & transcription                */
/* -------------------------------------------------------------------------- */

/**
 * Module 2 audio uploads.
 *
 * NO duration limit. Files can be seconds or hours long. Do not add a duration
 * check constraint to this table.
 */
export const audioUploads = pgTable("audio_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  contributionId: uuid("contribution_id").references((): AnyPgColumn => contributions.id),
  audioFileId: uuid("audio_file_id")
    .notNull()
    .references(() => audioFiles.id),
  title: text("title").notNull(),
  description: text("description"),
  recordingType: text("recording_type").notNull(),
  location: text("location"),
  recordedAt: date("recorded_at"),
  speakerDescription: text("speaker_description"),
  culturalContext: text("cultural_context"),
  source: text("source"),
  thirdPartyConsent: boolean("third_party_consent").default(false).notNull(),
  transcriptionStatus: text("transcription_status").default("none").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const transcriptions = pgTable("transcriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  audioUploadId: uuid("audio_upload_id")
    .notNull()
    .references(() => audioUploads.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  nativeText: text("native_text"),
  romanization: text("romanization"),
  ipa: text("ipa"),
  version: integer("version").default(1).notNull(),
  isCurrent: boolean("is_current").default(true).notNull(),
  previousVersion: uuid("previous_version").references((): AnyPgColumn => transcriptions.id),
  completeness: text("completeness").default("partial").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const transcriptionSegments = pgTable(
  "transcription_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    audioUploadId: uuid("audio_upload_id")
      .notNull()
      .references(() => audioUploads.id),
    transcriptionId: uuid("transcription_id").references(() => transcriptions.id),
    segmentIndex: integer("segment_index").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    nativeText: text("native_text"),
    romanization: text("romanization"),
    ipa: text("ipa"),
    speakerLabel: text("speaker_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check("ck_transcription_segment_start", sql`${t.startMs} >= 0`),
    check("ck_transcription_segment_order", sql`${t.endMs} > ${t.startMs}`),
  ],
);

/* -------------------------------------------------------------------------- */
/*                          Module 3 — translations                           */
/* -------------------------------------------------------------------------- */

/**
 * Module 3 translations.
 *
 * NO duration limit on the attached audio file. Do not add a duration check
 * constraint to this table.
 */
export const translations = pgTable("translations", {
  id: uuid("id").primaryKey().defaultRandom(),
  contributionId: uuid("contribution_id").references((): AnyPgColumn => contributions.id),
  sentenceId: uuid("sentence_id")
    .notNull()
    .references(() => sentences.id),
  audioFileId: uuid("audio_file_id").references(() => audioFiles.id),
  nativeText: text("native_text").notNull(),
  romanization: text("romanization"),
  ipa: text("ipa"),
  notes: text("notes"),
  variantIndex: smallint("variant_index").default(1).notNull(),
  version: integer("version").default(1).notNull(),
  isCurrent: boolean("is_current").default(true).notNull(),
  previousVersion: uuid("previous_version").references((): AnyPgColumn => translations.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/* -------------------------------------------------------------------------- */
/*                       Module 4 — scene contributions                       */
/* -------------------------------------------------------------------------- */

/**
 * Module 4 scene descriptions.
 *
 * NO duration limit. Descriptions run to 5 minutes or longer. Do not add a
 * duration check constraint to this table.
 */
export const sceneContributions = pgTable("scene_contributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  contributionId: uuid("contribution_id").references((): AnyPgColumn => contributions.id),
  sceneId: uuid("scene_id")
    .notNull()
    .references(() => scenes.id),
  audioFileId: uuid("audio_file_id")
    .notNull()
    .references(() => audioFiles.id),
  /** Added post-submission by annotators. */
  transcription: text("transcription"),
  transcriptionAddedAt: timestamp("transcription_added_at", { withTimezone: true }),
  transcriptionAddedBy: uuid("transcription_added_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/* -------------------------------------------------------------------------- */
/*                       Contributions — the central hub                      */
/* -------------------------------------------------------------------------- */

/**
 * The central hub table. Every contribution points at exactly one module payload,
 * enforced by `ck_contribution_single_reference`.
 */
export const contributions = pgTable(
  "contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    moduleType: contributionModule("module_type").notNull(),
    languageId: uuid("language_id")
      .notNull()
      .references(() => languages.id),
    dialectId: uuid("dialect_id").references(() => dialects.id),
    status: contributionStatus("status").default("pending").notNull(),
    basePoints: integer("base_points").default(0).notNull(),
    bonusPoints: integer("bonus_points").default(0).notNull(),
    totalPoints: integer("total_points").generatedAlwaysAs(
      sql`base_points + bonus_points`,
    ),
    pointsAwarded: boolean("points_awarded").default(false).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: uuid("verified_by").references(() => users.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectedBy: uuid("rejected_by").references(() => users.id),
    rejectionReason: text("rejection_reason"),
    qualityFlags: jsonb("quality_flags")
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    spamScore: numeric("spam_score", { precision: 3, scale: 2 }),
    wordRecordingId: uuid("word_recording_id").references((): AnyPgColumn => wordRecordings.id),
    audioUploadId: uuid("audio_upload_id").references((): AnyPgColumn => audioUploads.id),
    translationId: uuid("translation_id").references((): AnyPgColumn => translations.id),
    sceneContributionId: uuid("scene_contribution_id").references(
      (): AnyPgColumn => sceneContributions.id,
    ),
    deviceId: text("device_id"),
    appVersion: text("app_version"),
    /** web, ios, android */
    clientType: text("client_type"),
    ipAddress: text("ip_address"),
    accessLevel: dataAccessLevel("access_level").default("public").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
  },
  (t) => [
    index("ix_contributions_user").on(t.userId),
    index("ix_contributions_module_type").on(t.moduleType),
    index("ix_contributions_status").on(t.status),
    index("ix_contributions_pending_queue")
      .on(t.status, t.submittedAt)
      .where(sql`${t.status} = 'pending'`),
    /** Exactly one module payload per contribution. */
    check(
      "ck_contribution_single_reference",
      sql`(${t.wordRecordingId} IS NOT NULL)::int + (${t.audioUploadId} IS NOT NULL)::int + (${t.translationId} IS NOT NULL)::int + (${t.sceneContributionId} IS NOT NULL)::int = 1`,
    ),
    check("ck_contribution_base_points", sql`${t.basePoints} >= 0`),
    check("ck_contribution_bonus_points", sql`${t.bonusPoints} >= 0`),
  ],
);

/**
 * Review decisions. Immutable — no updates or deletes permitted, and
 * deliberately no `updated_at` column.
 */
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contributionId: uuid("contribution_id")
      .notNull()
      .references(() => contributions.id),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => users.id),
    decision: reviewDecision("decision").notNull(),
    reason: text("reason"),
    notes: text("notes"),
    statusBefore: contributionStatus("status_before").notNull(),
    statusAfter: contributionStatus("status_after").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("ix_reviews_contribution").on(t.contributionId),
    index("ix_reviews_reviewer").on(t.reviewerId),
  ],
);

/* -------------------------------------------------------------------------- */
/*                          Stats and gamification                            */
/* -------------------------------------------------------------------------- */

export const userStats = pgTable("user_stats", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  totalContributions: integer("total_contributions").default(0).notNull(),
  verifiedContributions: integer("verified_contributions").default(0).notNull(),
  pendingContributions: integer("pending_contributions").default(0).notNull(),
  rejectedContributions: integer("rejected_contributions").default(0).notNull(),
  wordContributions: integer("word_contributions").default(0).notNull(),
  audioContributions: integer("audio_contributions").default(0).notNull(),
  translationContributions: integer("translation_contributions").default(0).notNull(),
  sceneContributionsCount: integer("scene_contributions_count").default(0).notNull(),
  verifiedWords: integer("verified_words").default(0).notNull(),
  verifiedAudios: integer("verified_audios").default(0).notNull(),
  verifiedTranslations: integer("verified_translations").default(0).notNull(),
  verifiedScenes: integer("verified_scenes").default(0).notNull(),
  totalPoints: integer("total_points").default(0).notNull(),
  pointsThisWeek: integer("points_this_week").default(0).notNull(),
  pointsThisMonth: integer("points_this_month").default(0).notNull(),
  level: contributorLevel("level").default("BRONZE").notNull(),
  reviewsCompleted: integer("reviews_completed").default(0).notNull(),
  totalAudioDurationMs: bigint("total_audio_duration_ms", { mode: "number" }).default(0).notNull(),
  lastContributionAt: timestamp("last_contribution_at", { withTimezone: true }),
  lastContributionModule: contributionModule("last_contribution_module"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const streaks = pgTable("streaks", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  currentStreak: integer("current_streak").default(0).notNull(),
  longestStreak: integer("longest_streak").default(0).notNull(),
  status: streakStatus("status").default("active").notNull(),
  lastActivityDate: date("last_activity_date")
    .default(sql`current_date`)
    .notNull(),
  lastActivityTz: text("last_activity_tz").default("UTC").notNull(),
  qualifyingContributionsToday: integer("qualifying_contributions_today").default(0).notNull(),
  streakStartedAt: timestamp("streak_started_at", { withTimezone: true }),
  lastBreakDate: date("last_break_date"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const gamificationConfig = pgTable(
  "gamification_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    configKey: text("config_key").notNull(),
    configValue: jsonb("config_value").notNull(),
    description: text("description").notNull(),
    module: text("module"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    uniqueIndex("uq_gamification_config_key_active")
      .on(t.configKey)
      .where(sql`${t.isActive} = true`),
  ],
);

/**
 * Points ledger. Immutable — no updates or deletes, and deliberately no
 * `updated_at`. `idempotencyKey` prevents double-awarding.
 */
export const pointsTransactions = pgTable(
  "points_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    contributionId: uuid("contribution_id").references(() => contributions.id),
    points: integer("points").notNull(),
    reason: text("reason").notNull(),
    moduleType: contributionModule("module_type"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("ix_points_transactions_user").on(t.userId),
    index("ix_points_transactions_contribution").on(t.contributionId),
  ],
);

export const badges = pgTable("badges", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
  category: text("category").notNull(),
  triggerType: badgeTriggerType("trigger_type").notNull(),
  triggerValue: integer("trigger_value"),
  triggerModule: contributionModule("trigger_module"),
  isActive: boolean("is_active").default(true).notNull(),
  isHidden: boolean("is_hidden").default(false).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const userBadges = pgTable(
  "user_badges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    badgeId: uuid("badge_id")
      .notNull()
      .references(() => badges.id),
    triggerContributionId: uuid("trigger_contribution_id").references(() => contributions.id),
    earnedAt: timestamp("earned_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_user_badges_user_badge").on(t.userId, t.badgeId),
    index("ix_user_badges_user").on(t.userId),
  ],
);

export const perks = pgTable("perks", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  perkType: text("perk_type").notNull(),
  requiredLevel: contributorLevel("required_level").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const leaderboardSnapshots = pgTable(
  "leaderboard_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** all_time, weekly, monthly */
    period: text("period").notNull(),
    /** all_time, 2024-W42, 2024-10 */
    periodKey: text("period_key").notNull(),
    rank: integer("rank").notNull(),
    totalPoints: integer("total_points").notNull(),
    verifiedContributions: integer("verified_contributions").notNull(),
    displayName: text("display_name").notNull(),
    level: contributorLevel("level").notNull(),
    languageCode: text("language_code"),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_leaderboard_user_period").on(t.userId, t.period, t.periodKey),
    index("ix_leaderboard_period_rank").on(t.period, t.periodKey, t.rank),
  ],
);

/* -------------------------------------------------------------------------- */
/*                               Notifications                                */
/* -------------------------------------------------------------------------- */

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: notificationChannel("channel").notNull(),
    status: notificationStatus("status").default("pending").notNull(),
    notificationType: text("notification_type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: jsonb("data")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    failedReason: text("failed_reason"),
    retryCount: smallint("retry_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("ix_notifications_user").on(t.userId),
    index("ix_notifications_unread")
      .on(t.userId, t.readAt)
      .where(sql`${t.readAt} is null`),
  ],
);

/* -------------------------------------------------------------------------- */
/*                        Consent, audit and governance                       */
/* -------------------------------------------------------------------------- */

export const consents = pgTable("consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  consentVersion: text("consent_version").notNull(),
  consentStatus: consentStatus("consent_status").default("granted").notNull(),
  consentedAt: timestamp("consented_at", { withTimezone: true }),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  license: text("license").default("CC-BY-4.0").notNull(),
  researchPermission: boolean("research_permission").default(true).notNull(),
  commercialPermission: boolean("commercial_permission").default(false).notNull(),
  aiTrainingPermission: boolean("ai_training_permission").default(false).notNull(),
  isOwnContent: boolean("is_own_content").default(true).notNull(),
  accessLevel: dataAccessLevel("access_level").default("public").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Append-only audit trail. No updates or deletes, and no `updated_at`. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id),
    actorRole: userRole("actor_role"),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    beforeState: jsonb("before_state").$type<Record<string, unknown>>(),
    afterState: jsonb("after_state").$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("ix_audit_logs_actor").on(t.actorId),
    index("ix_audit_logs_resource").on(t.resourceType, t.resourceId),
    index("ix_audit_logs_created_at").on(t.createdAt),
  ],
);

export const featureFlags = pgTable(
  "feature_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    flagKey: text("flag_key").notNull().unique(),
    isEnabled: boolean("is_enabled").default(false).notNull(),
    description: text("description").notNull(),
    rolloutPercent: integer("rollout_percent").default(100).notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [check("ck_feature_flags_rollout_percent", sql`${t.rolloutPercent} between 0 and 100`)],
);

export const dataExports = pgTable("data_exports", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestedBy: uuid("requested_by")
    .notNull()
    .references(() => users.id),
  exportFormat: exportFormat("export_format").notNull(),
  status: exportStatus("status").default("pending").notNull(),
  filters: jsonb("filters")
    .$type<Record<string, unknown>>()
    .default(sql`'{}'::jsonb`)
    .notNull(),
  rowCount: bigint("row_count", { mode: "number" }),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
  storageKey: text("storage_key"),
  downloadUrl: text("download_url"),
  downloadExpiresAt: timestamp("download_expires_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const contributorProfiles = pgTable("contributor_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  primaryLanguageId: uuid("primary_language_id").references(() => languages.id),
  primaryDialectId: uuid("primary_dialect_id").references(() => dialects.id),
  locationCountry: text("location_country"),
  locationRegion: text("location_region"),
  locationCity: text("location_city"),
  locationVillage: text("location_village"),
  tribe: text("tribe"),
  ageRange: text("age_range"),
  speakerNotes: text("speaker_notes"),
  publicProfile: boolean("public_profile").default(true).notNull(),
  showLocation: boolean("show_location").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Growable taxonomies for the onboarding demographics form. Each is a
 * user-extensible lookup: the form offers existing rows in a combobox, but a
 * contributor can also add a new one that becomes available to everyone
 * afterward (tribes/villages don't have a fixed enumerable list up front).
 */
export const tribes = pgTable("tribes", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const subTribes = pgTable(
  "sub_tribes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tribeId: uuid("tribe_id")
      .notNull()
      .references(() => tribes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("sub_tribes_tribe_id_name_key").on(table.tribeId, table.name)],
);

export const villages = pgTable(
  "villages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    country: text("country").notNull(),
    city: text("city").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("villages_country_city_name_key").on(table.country, table.city, table.name)],
);

export const quarters = pgTable(
  "quarters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    villageId: uuid("village_id")
      .notNull()
      .references(() => villages.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("quarters_village_id_name_key").on(table.villageId, table.name)],
);

export const genderEnum = pgEnum("gender", ["male", "female", "other", "prefer_not_to_say"]);

/**
 * The onboarding form shown right after registration. Kept separate from
 * contributorProfiles (which predates this form and serves the
 * profile-settings page) rather than folding fields in, since this table's
 * columns are all required at signup time and profile settings' fields are
 * all optional/editable later.
 */
export const contributorDemographics = pgTable("contributor_demographics", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  age: integer("age").notNull(),
  gender: genderEnum("gender").notNull(),
  motherTongue: text("mother_tongue").notNull(),
  tribeId: uuid("tribe_id")
    .notNull()
    .references(() => tribes.id),
  subTribeId: uuid("sub_tribe_id").references(() => subTribes.id),
  country: text("country").notNull(),
  city: text("city").notNull(),
  villageId: uuid("village_id")
    .notNull()
    .references(() => villages.id),
  quarterId: uuid("quarter_id").references(() => quarters.id),
  dialect: text("dialect"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* -------------------------------------------------------------------------- */
/*                                  Relations                                 */
/* -------------------------------------------------------------------------- */

export const usersRelations = relations(users, ({ one, many }) => ({
  contributions: many(contributions, { relationName: "contribution_author" }),
  refreshTokens: many(refreshTokens),
  deviceTokens: many(deviceTokens),
  additionalPermissions: many(userAdditionalPermissions, { relationName: "permission_holder" }),
  reviews: many(reviews),
  stats: one(userStats, { fields: [users.id], references: [userStats.userId] }),
  streak: one(streaks, { fields: [users.id], references: [streaks.userId] }),
  profile: one(contributorProfiles, {
    fields: [users.id],
    references: [contributorProfiles.userId],
  }),
  badges: many(userBadges),
  pointsTransactions: many(pointsTransactions),
  notifications: many(notifications),
  consents: many(consents),
  auditLogs: many(auditLogs),
  uploadedAudioFiles: many(audioFiles),
  transcriptions: many(transcriptions),
  dataExports: many(dataExports),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export const deviceTokensRelations = relations(deviceTokens, ({ one }) => ({
  user: one(users, { fields: [deviceTokens.userId], references: [users.id] }),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
  userAdditionalPermissions: many(userAdditionalPermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const userAdditionalPermissionsRelations = relations(
  userAdditionalPermissions,
  ({ one }) => ({
    user: one(users, {
      fields: [userAdditionalPermissions.userId],
      references: [users.id],
      relationName: "permission_holder",
    }),
    permission: one(permissions, {
      fields: [userAdditionalPermissions.permissionId],
      references: [permissions.id],
    }),
    grantedByUser: one(users, {
      fields: [userAdditionalPermissions.grantedBy],
      references: [users.id],
      relationName: "permission_granter",
    }),
  }),
);

export const languagesRelations = relations(languages, ({ many }) => ({
  dialects: many(dialects),
  contributions: many(contributions),
}));

export const dialectsRelations = relations(dialects, ({ one, many }) => ({
  language: one(languages, { fields: [dialects.languageId], references: [languages.id] }),
  contributions: many(contributions),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "category_tree",
  }),
  children: many(categories, { relationName: "category_tree" }),
  concepts: many(concepts),
  sentences: many(sentences),
}));

export const conceptsRelations = relations(concepts, ({ one, many }) => ({
  category: one(categories, { fields: [concepts.categoryId], references: [categories.id] }),
  media: many(conceptMedia),
  wordRecordings: many(wordRecordings),
  sceneConcepts: many(sceneConcepts),
}));

export const conceptMediaRelations = relations(conceptMedia, ({ one }) => ({
  concept: one(concepts, { fields: [conceptMedia.conceptId], references: [concepts.id] }),
}));

export const sentencesRelations = relations(sentences, ({ one, many }) => ({
  category: one(categories, { fields: [sentences.categoryId], references: [categories.id] }),
  translations: many(translations),
}));

export const scenesRelations = relations(scenes, ({ many }) => ({
  media: many(sceneMedia),
  sceneConcepts: many(sceneConcepts),
  contributions: many(sceneContributions),
}));

export const sceneMediaRelations = relations(sceneMedia, ({ one }) => ({
  scene: one(scenes, { fields: [sceneMedia.sceneId], references: [scenes.id] }),
}));

export const sceneConceptsRelations = relations(sceneConcepts, ({ one }) => ({
  scene: one(scenes, { fields: [sceneConcepts.sceneId], references: [scenes.id] }),
  concept: one(concepts, { fields: [sceneConcepts.conceptId], references: [concepts.id] }),
  category: one(categories, { fields: [sceneConcepts.categoryId], references: [categories.id] }),
}));

export const audioFilesRelations = relations(audioFiles, ({ one, many }) => ({
  uploader: one(users, { fields: [audioFiles.uploadedBy], references: [users.id] }),
  wordRecordings: many(wordRecordings),
  audioUploads: many(audioUploads),
  translations: many(translations),
  sceneContributions: many(sceneContributions),
}));

export const wordRecordingsRelations = relations(wordRecordings, ({ one }) => ({
  contribution: one(contributions, {
    fields: [wordRecordings.contributionId],
    references: [contributions.id],
    relationName: "word_recording_payload",
  }),
  concept: one(concepts, { fields: [wordRecordings.conceptId], references: [concepts.id] }),
  audioFile: one(audioFiles, {
    fields: [wordRecordings.audioFileId],
    references: [audioFiles.id],
  }),
  supersededByRecording: one(wordRecordings, {
    fields: [wordRecordings.supersededBy],
    references: [wordRecordings.id],
    relationName: "word_recording_supersession",
  }),
}));

export const audioUploadsRelations = relations(audioUploads, ({ one, many }) => ({
  contribution: one(contributions, {
    fields: [audioUploads.contributionId],
    references: [contributions.id],
    relationName: "audio_upload_payload",
  }),
  audioFile: one(audioFiles, { fields: [audioUploads.audioFileId], references: [audioFiles.id] }),
  transcriptions: many(transcriptions),
  segments: many(transcriptionSegments),
}));

export const transcriptionsRelations = relations(transcriptions, ({ one, many }) => ({
  audioUpload: one(audioUploads, {
    fields: [transcriptions.audioUploadId],
    references: [audioUploads.id],
  }),
  user: one(users, { fields: [transcriptions.userId], references: [users.id] }),
  previous: one(transcriptions, {
    fields: [transcriptions.previousVersion],
    references: [transcriptions.id],
    relationName: "transcription_versions",
  }),
  segments: many(transcriptionSegments),
}));

export const transcriptionSegmentsRelations = relations(transcriptionSegments, ({ one }) => ({
  audioUpload: one(audioUploads, {
    fields: [transcriptionSegments.audioUploadId],
    references: [audioUploads.id],
  }),
  transcription: one(transcriptions, {
    fields: [transcriptionSegments.transcriptionId],
    references: [transcriptions.id],
  }),
}));

export const translationsRelations = relations(translations, ({ one }) => ({
  contribution: one(contributions, {
    fields: [translations.contributionId],
    references: [contributions.id],
    relationName: "translation_payload",
  }),
  sentence: one(sentences, { fields: [translations.sentenceId], references: [sentences.id] }),
  audioFile: one(audioFiles, { fields: [translations.audioFileId], references: [audioFiles.id] }),
  previous: one(translations, {
    fields: [translations.previousVersion],
    references: [translations.id],
    relationName: "translation_versions",
  }),
}));

export const sceneContributionsRelations = relations(sceneContributions, ({ one }) => ({
  contribution: one(contributions, {
    fields: [sceneContributions.contributionId],
    references: [contributions.id],
    relationName: "scene_contribution_payload",
  }),
  scene: one(scenes, { fields: [sceneContributions.sceneId], references: [scenes.id] }),
  audioFile: one(audioFiles, {
    fields: [sceneContributions.audioFileId],
    references: [audioFiles.id],
  }),
  transcriptionAuthor: one(users, {
    fields: [sceneContributions.transcriptionAddedBy],
    references: [users.id],
  }),
}));

export const contributionsRelations = relations(contributions, ({ one, many }) => ({
  user: one(users, {
    fields: [contributions.userId],
    references: [users.id],
    relationName: "contribution_author",
  }),
  language: one(languages, { fields: [contributions.languageId], references: [languages.id] }),
  dialect: one(dialects, { fields: [contributions.dialectId], references: [dialects.id] }),
  verifier: one(users, {
    fields: [contributions.verifiedBy],
    references: [users.id],
    relationName: "contribution_verifier",
  }),
  rejecter: one(users, {
    fields: [contributions.rejectedBy],
    references: [users.id],
    relationName: "contribution_rejecter",
  }),
  wordRecording: one(wordRecordings, {
    fields: [contributions.wordRecordingId],
    references: [wordRecordings.id],
    relationName: "word_recording_payload",
  }),
  audioUpload: one(audioUploads, {
    fields: [contributions.audioUploadId],
    references: [audioUploads.id],
    relationName: "audio_upload_payload",
  }),
  translation: one(translations, {
    fields: [contributions.translationId],
    references: [translations.id],
    relationName: "translation_payload",
  }),
  sceneContribution: one(sceneContributions, {
    fields: [contributions.sceneContributionId],
    references: [sceneContributions.id],
    relationName: "scene_contribution_payload",
  }),
  reviews: many(reviews),
  pointsTransactions: many(pointsTransactions),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  contribution: one(contributions, {
    fields: [reviews.contributionId],
    references: [contributions.id],
  }),
  reviewer: one(users, { fields: [reviews.reviewerId], references: [users.id] }),
}));

export const userStatsRelations = relations(userStats, ({ one }) => ({
  user: one(users, { fields: [userStats.userId], references: [users.id] }),
}));

export const streaksRelations = relations(streaks, ({ one }) => ({
  user: one(users, { fields: [streaks.userId], references: [users.id] }),
}));

export const gamificationConfigRelations = relations(gamificationConfig, ({ one }) => ({
  updatedByUser: one(users, { fields: [gamificationConfig.updatedBy], references: [users.id] }),
}));

export const pointsTransactionsRelations = relations(pointsTransactions, ({ one }) => ({
  user: one(users, { fields: [pointsTransactions.userId], references: [users.id] }),
  contribution: one(contributions, {
    fields: [pointsTransactions.contributionId],
    references: [contributions.id],
  }),
}));

export const badgesRelations = relations(badges, ({ many }) => ({
  userBadges: many(userBadges),
}));

export const userBadgesRelations = relations(userBadges, ({ one }) => ({
  user: one(users, { fields: [userBadges.userId], references: [users.id] }),
  badge: one(badges, { fields: [userBadges.badgeId], references: [badges.id] }),
  triggerContribution: one(contributions, {
    fields: [userBadges.triggerContributionId],
    references: [contributions.id],
  }),
}));

export const leaderboardSnapshotsRelations = relations(leaderboardSnapshots, ({ one }) => ({
  user: one(users, { fields: [leaderboardSnapshots.userId], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const consentsRelations = relations(consents, ({ one }) => ({
  user: one(users, { fields: [consents.userId], references: [users.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, { fields: [auditLogs.actorId], references: [users.id] }),
}));

export const featureFlagsRelations = relations(featureFlags, ({ one }) => ({
  updatedByUser: one(users, { fields: [featureFlags.updatedBy], references: [users.id] }),
}));

export const dataExportsRelations = relations(dataExports, ({ one }) => ({
  requester: one(users, { fields: [dataExports.requestedBy], references: [users.id] }),
}));

export const contributorProfilesRelations = relations(contributorProfiles, ({ one }) => ({
  user: one(users, { fields: [contributorProfiles.userId], references: [users.id] }),
  primaryLanguage: one(languages, {
    fields: [contributorProfiles.primaryLanguageId],
    references: [languages.id],
  }),
  primaryDialect: one(dialects, {
    fields: [contributorProfiles.primaryDialectId],
    references: [dialects.id],
  }),
}));

export const tribesRelations = relations(tribes, ({ many }) => ({
  subTribes: many(subTribes),
}));

export const subTribesRelations = relations(subTribes, ({ one }) => ({
  tribe: one(tribes, { fields: [subTribes.tribeId], references: [tribes.id] }),
}));

export const villagesRelations = relations(villages, ({ many }) => ({
  quarters: many(quarters),
}));

export const quartersRelations = relations(quarters, ({ one }) => ({
  village: one(villages, { fields: [quarters.villageId], references: [villages.id] }),
}));

export const contributorDemographicsRelations = relations(contributorDemographics, ({ one }) => ({
  user: one(users, { fields: [contributorDemographics.userId], references: [users.id] }),
  tribe: one(tribes, { fields: [contributorDemographics.tribeId], references: [tribes.id] }),
  subTribe: one(subTribes, { fields: [contributorDemographics.subTribeId], references: [subTribes.id] }),
  village: one(villages, { fields: [contributorDemographics.villageId], references: [villages.id] }),
  quarter: one(quarters, { fields: [contributorDemographics.quarterId], references: [quarters.id] }),
}));
