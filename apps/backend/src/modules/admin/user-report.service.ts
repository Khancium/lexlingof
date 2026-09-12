import PDFDocument from "pdfkit";
import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";

import { db } from "../../db/index.js";
import {
  contributorDemographics,
  quarters,
  subTribes,
  tribes,
  users,
  userStats,
  villages,
} from "../../db/schema.js";

/**
 * The full user record as it appears in a report: account, everything filled
 * in at signup, and the activity rollup. Shared with GET /admin/users/:id so
 * the "Details" panel and the downloaded report can never disagree.
 */
export const userReportSelection = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  role: users.role,
  avatarUrl: users.avatarUrl,
  biography: users.biography,
  isActive: users.isActive,
  isSuspended: users.isSuspended,
  suspendedReason: users.suspendedReason,
  suspendedUntil: users.suspendedUntil,
  isRestricted: users.isRestricted,
  restrictedReason: users.restrictedReason,
  createdAt: users.createdAt,
  lastSeenAt: users.lastSeenAt,
  fullName: contributorDemographics.fullName,
  age: contributorDemographics.age,
  dateOfBirth: contributorDemographics.dateOfBirth,
  gender: contributorDemographics.gender,
  motherTongue: contributorDemographics.motherTongue,
  country: contributorDemographics.country,
  city: contributorDemographics.city,
  dialect: contributorDemographics.dialect,
  educationLevel: contributorDemographics.educationLevel,
  profession: contributorDemographics.profession,
  tribeName: tribes.name,
  subTribeName: subTribes.name,
  villageName: villages.name,
  quarterName: quarters.name,
  level: userStats.level,
  totalPoints: userStats.totalPoints,
  pointsThisWeek: userStats.pointsThisWeek,
  pointsThisMonth: userStats.pointsThisMonth,
  totalContributions: userStats.totalContributions,
  verifiedContributions: userStats.verifiedContributions,
  pendingContributions: userStats.pendingContributions,
  rejectedContributions: userStats.rejectedContributions,
  wordContributions: userStats.wordContributions,
  audioContributions: userStats.audioContributions,
  translationContributions: userStats.translationContributions,
  sceneContributionsCount: userStats.sceneContributionsCount,
  verifiedWords: userStats.verifiedWords,
  verifiedAudios: userStats.verifiedAudios,
  verifiedTranslations: userStats.verifiedTranslations,
  verifiedScenes: userStats.verifiedScenes,
  reviewsCompleted: userStats.reviewsCompleted,
  totalAudioDurationMs: userStats.totalAudioDurationMs,
  lastContributionAt: userStats.lastContributionAt,
  lastContributionModule: userStats.lastContributionModule,
} as const;

export type UserReportRow = Awaited<ReturnType<typeof fetchUserReportRows>>[number];

/** Every join the report needs, in one place, so the row shape is identical whichever endpoint asked for it. */
export function userReportQuery(where: SQL) {
  return db
    .select(userReportSelection)
    .from(users)
    .leftJoin(contributorDemographics, eq(contributorDemographics.userId, users.id))
    .leftJoin(tribes, eq(tribes.id, contributorDemographics.tribeId))
    .leftJoin(subTribes, eq(subTribes.id, contributorDemographics.subTribeId))
    .leftJoin(villages, eq(villages.id, contributorDemographics.villageId))
    .leftJoin(quarters, eq(quarters.id, contributorDemographics.quarterId))
    .leftJoin(userStats, eq(userStats.userId, users.id))
    .where(where);
}

export async function fetchUserReportRows(userIds: string[]) {
  if (userIds.length === 0) return [];
  return userReportQuery(and(inArray(users.id, userIds), isNull(users.deletedAt))!);
}

/* ---------------------------------- CSV ----------------------------------- */

/**
 * Column order is the reading order of the report: identity, then the signup
 * form, then activity. Kept as an explicit list rather than derived from the
 * selection so adding an internal column does not silently change the file
 * every downstream spreadsheet is built against.
 */
const CSV_COLUMNS: { key: keyof UserReportRow; header: string }[] = [
  { key: "id", header: "User ID" },
  { key: "displayName", header: "Display Name" },
  { key: "fullName", header: "Full Name" },
  { key: "email", header: "Email" },
  { key: "role", header: "Role" },
  { key: "createdAt", header: "Joined At" },
  { key: "lastSeenAt", header: "Last Seen At" },
  { key: "isSuspended", header: "Suspended" },
  { key: "suspendedReason", header: "Suspension Reason" },
  { key: "suspendedUntil", header: "Suspended Until" },
  { key: "isRestricted", header: "Restricted" },
  { key: "restrictedReason", header: "Restriction Reason" },
  { key: "age", header: "Age" },
  { key: "dateOfBirth", header: "Date of Birth" },
  { key: "gender", header: "Gender" },
  { key: "motherTongue", header: "Mother Tongue" },
  { key: "dialect", header: "Dialect" },
  { key: "tribeName", header: "Tribe" },
  { key: "subTribeName", header: "Sub-Tribe" },
  { key: "country", header: "Country" },
  { key: "city", header: "City" },
  { key: "villageName", header: "Village" },
  { key: "quarterName", header: "Quarter" },
  { key: "educationLevel", header: "Education Level" },
  { key: "profession", header: "Profession" },
  { key: "level", header: "Level" },
  { key: "totalPoints", header: "Total Points" },
  { key: "pointsThisWeek", header: "Points (Week)" },
  { key: "pointsThisMonth", header: "Points (Month)" },
  { key: "totalContributions", header: "Total Contributions" },
  { key: "verifiedContributions", header: "Verified" },
  { key: "pendingContributions", header: "Pending" },
  { key: "rejectedContributions", header: "Rejected" },
  { key: "wordContributions", header: "Words" },
  { key: "verifiedWords", header: "Words Verified" },
  { key: "audioContributions", header: "Audio Uploads" },
  { key: "verifiedAudios", header: "Audio Verified" },
  { key: "translationContributions", header: "Translations" },
  { key: "verifiedTranslations", header: "Translations Verified" },
  { key: "sceneContributionsCount", header: "Scenes" },
  { key: "verifiedScenes", header: "Scenes Verified" },
  { key: "reviewsCompleted", header: "Peer Reviews Completed" },
  { key: "totalAudioDurationMs", header: "Total Audio (ms)" },
  { key: "lastContributionAt", header: "Last Contribution At" },
  { key: "lastContributionModule", header: "Last Contribution Module" },
];

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  // Excel treats a leading =, +, - or @ as the start of a formula, so a name
  // like "=cmd" would execute on open. Prefixing a single quote neutralises
  // that without altering what the cell reads as.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function buildUsersCsv(rows: UserReportRow[]): string {
  const lines = [CSV_COLUMNS.map((c) => csvCell(c.header)).join(",")];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((c) => csvCell(row[c.key])).join(","));
  }
  // BOM so Excel opens the file as UTF-8 rather than the local codepage --
  // without it non-Latin names (Pashto, Urdu) render as mojibake.
  return `﻿${lines.join("\r\n")}\r\n`;
}

/* ---------------------------------- PDF ----------------------------------- */

/**
 * pdfkit's built-in fonts are WinAnsi-encoded and throw on characters outside
 * it. Names in Arabic/Pashto script are legitimate data here, so rather than
 * failing the whole download, unrepresentable characters are replaced and the
 * report points the reader at the CSV, which is lossless UTF-8.
 */
function pdfSafe(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  const text = value instanceof Date ? value.toISOString().replace("T", " ").slice(0, 19) : String(value);
  return text.replace(/[^ -~ -ÿ]/g, "?");
}

type Field = { label: string; value: unknown };

function sectionFields(row: UserReportRow) {
  return {
    Account: [
      { label: "User ID", value: row.id },
      { label: "Display Name", value: row.displayName },
      { label: "Email", value: row.email },
      { label: "Role", value: row.role },
      { label: "Joined", value: row.createdAt },
      { label: "Last Seen", value: row.lastSeenAt },
      {
        label: "Status",
        value: row.isSuspended ? "Suspended" : row.isRestricted ? "Restricted" : "Active",
      },
      { label: "Status Reason", value: row.suspendedReason ?? row.restrictedReason },
    ] as Field[],
    "Signup Details": [
      { label: "Full Name", value: row.fullName },
      { label: "Age", value: row.age },
      { label: "Date of Birth", value: row.dateOfBirth },
      { label: "Gender", value: row.gender },
      { label: "Mother Tongue", value: row.motherTongue },
      { label: "Dialect", value: row.dialect },
      { label: "Tribe", value: row.tribeName },
      { label: "Sub-Tribe", value: row.subTribeName },
      { label: "Country", value: row.country },
      { label: "City", value: row.city },
      { label: "Village", value: row.villageName },
      { label: "Quarter", value: row.quarterName },
      { label: "Education", value: row.educationLevel },
      { label: "Profession", value: row.profession },
    ] as Field[],
    Activity: [
      { label: "Level", value: row.level },
      { label: "Total Points", value: row.totalPoints ?? 0 },
      { label: "Points (Week)", value: row.pointsThisWeek ?? 0 },
      { label: "Points (Month)", value: row.pointsThisMonth ?? 0 },
      { label: "Total Contributions", value: row.totalContributions ?? 0 },
      { label: "Verified", value: row.verifiedContributions ?? 0 },
      { label: "Pending", value: row.pendingContributions ?? 0 },
      { label: "Rejected", value: row.rejectedContributions ?? 0 },
      { label: "Words", value: `${row.wordContributions ?? 0} (${row.verifiedWords ?? 0} verified)` },
      { label: "Audio Uploads", value: `${row.audioContributions ?? 0} (${row.verifiedAudios ?? 0} verified)` },
      {
        label: "Translations",
        value: `${row.translationContributions ?? 0} (${row.verifiedTranslations ?? 0} verified)`,
      },
      { label: "Scenes", value: `${row.sceneContributionsCount ?? 0} (${row.verifiedScenes ?? 0} verified)` },
      { label: "Peer Reviews Done", value: row.reviewsCompleted ?? 0 },
      { label: "Total Audio", value: formatDuration(row.totalAudioDurationMs) },
      { label: "Last Contribution", value: row.lastContributionAt },
      { label: "Last Module", value: row.lastContributionModule },
    ] as Field[],
  };
}

function formatDuration(ms: number | null | undefined) {
  if (!ms) return "0s";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const BRAND = "#2563eb";
const MUTED = "#64748b";

export function buildUsersPdf(rows: UserReportRow[], generatedBy: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const isConsolidated = rows.length > 1;

  // Header block.
  doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(20).text("Lexlingo", left, 48);
  doc
    .fillColor("#0f172a")
    .fontSize(14)
    .text(isConsolidated ? `Consolidated User Report (${rows.length} users)` : "User Report");
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(9)
    .text(`Generated ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC by ${pdfSafe(generatedBy)}`);
  doc.moveDown(0.4);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor("#e2e8f0").stroke();
  doc.moveDown(0.8);

  if (isConsolidated) {
    // A consolidated report is read top-down for the aggregate first, so the
    // totals go on the first page before any individual record.
    const sum = (pick: (r: UserReportRow) => number | null | undefined) =>
      rows.reduce((acc, r) => acc + (pick(r) ?? 0), 0);
    const totals: Field[] = [
      { label: "Users in report", value: rows.length },
      { label: "Total contributions", value: sum((r) => r.totalContributions) },
      { label: "Verified contributions", value: sum((r) => r.verifiedContributions) },
      { label: "Pending contributions", value: sum((r) => r.pendingContributions) },
      { label: "Rejected contributions", value: sum((r) => r.rejectedContributions) },
      { label: "Total points", value: sum((r) => r.totalPoints) },
      { label: "Peer reviews completed", value: sum((r) => r.reviewsCompleted) },
      { label: "Total audio recorded", value: formatDuration(sum((r) => r.totalAudioDurationMs)) },
    ];
    drawSection(doc, "Summary", totals, left, width);
    doc.moveDown(0.5);
  }

  rows.forEach((row, index) => {
    if (isConsolidated) {
      if (index > 0 || doc.y > doc.page.height - 260) doc.addPage();
      doc
        .fillColor(BRAND)
        .font("Helvetica-Bold")
        .fontSize(13)
        .text(`${index + 1}. ${pdfSafe(row.fullName ?? row.displayName)}`, left, doc.y);
      doc.fillColor(MUTED).font("Helvetica").fontSize(9).text(pdfSafe(row.email));
      doc.moveDown(0.5);
    }
    const sections = sectionFields(row);
    for (const [title, fields] of Object.entries(sections)) {
      drawSection(doc, title, fields, left, width);
    }
  });

  // Page numbers, added after layout so the total is known. The footer sits
  // below the bottom margin, and pdfkit auto-appends a fresh page for any text
  // that crosses it -- so the margin is zeroed for the duration, otherwise
  // every report gains a trailing blank page.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0;
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(8)
      .text(`Page ${i + 1} of ${range.count}`, left, doc.page.height - 34, { width, align: "center" });
  }

  doc.end();
  return done;
}

/** Two-column label/value grid with a page break before any section that would otherwise be orphaned. */
function drawSection(doc: PDFKit.PDFDocument, title: string, fields: Field[], left: number, width: number) {
  const rowHeight = 16;
  const needed = 26 + Math.ceil(fields.length / 2) * rowHeight;
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();

  doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(10).text(title.toUpperCase(), left, doc.y);
  doc.moveDown(0.3);

  const colWidth = width / 2;
  const labelWidth = 96;
  let y = doc.y;

  fields.forEach((field, i) => {
    const col = i % 2;
    const x = left + col * colWidth;
    if (col === 0 && i > 0) y += rowHeight;
    doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(`${field.label}`, x, y, { width: labelWidth });
    doc
      .fillColor("#0f172a")
      .font("Helvetica")
      .fontSize(9)
      .text(pdfSafe(field.value), x + labelWidth, y - 1, {
        width: colWidth - labelWidth - 10,
        height: rowHeight,
        ellipsis: true,
        lineBreak: false,
      });
  });

  doc.y = y + rowHeight + 8;
  doc.x = left;
}
