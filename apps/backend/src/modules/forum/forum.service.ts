import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "../../db/index.js";
import {
  concepts,
  conceptMedia,
  forumCommentReactions,
  forumComments,
  forumPostReactions,
  forumPosts,
  sentences,
  users,
} from "../../db/schema.js";
import { storageService } from "../../services/storage.service.js";
import { HttpError } from "../../utils/http-error.js";

export type ForumReactionType = (typeof forumPostReactions.$inferInsert)["reactionType"];

const AUTHOR_SELECT = { id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl } as const;

/** Grouped reaction counts for a batch of posts or comments -- one query covering every target id, not one query per row. */
async function countReactionsByTarget(
  table: typeof forumPostReactions | typeof forumCommentReactions,
  targetColumn: typeof forumPostReactions.postId | typeof forumCommentReactions.commentId,
  targetIds: string[],
): Promise<Map<string, Partial<Record<ForumReactionType, number>>>> {
  if (targetIds.length === 0) return new Map();
  const rows = await db
    .select({ targetId: targetColumn, reactionType: table.reactionType, value: sql<number>`count(*)`.mapWith(Number) })
    .from(table)
    .where(inArray(targetColumn, targetIds))
    .groupBy(targetColumn, table.reactionType);

  const byTarget = new Map<string, Partial<Record<ForumReactionType, number>>>();
  for (const row of rows) {
    const counts = byTarget.get(row.targetId) ?? {};
    counts[row.reactionType] = row.value;
    byTarget.set(row.targetId, counts);
  }
  return byTarget;
}

/** The current user's own reaction (if any) for a batch of posts or comments -- same batching reasoning as above. */
async function myReactionsByTarget(
  table: typeof forumPostReactions | typeof forumCommentReactions,
  targetColumn: typeof forumPostReactions.postId | typeof forumCommentReactions.commentId,
  userColumn: typeof forumPostReactions.userId | typeof forumCommentReactions.userId,
  targetIds: string[],
  userId: string,
): Promise<Map<string, ForumReactionType>> {
  if (targetIds.length === 0) return new Map();
  const rows = await db
    .select({ targetId: targetColumn, reactionType: table.reactionType })
    .from(table)
    .where(and(inArray(targetColumn, targetIds), eq(userColumn, userId)));
  return new Map(rows.map((r) => [r.targetId, r.reactionType]));
}

export type CreatePostInput = {
  body: string;
  conceptId?: string;
  sentenceId?: string;
  gifUrl?: string;
  image?: { buffer: Buffer; filename: string };
};

export async function createPost(userId: string, input: CreatePostInput) {
  if (input.conceptId) {
    const [concept] = await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.id, input.conceptId)).limit(1);
    if (!concept) throw new HttpError(404, "NOT_FOUND", "Concept not found");
  }
  if (input.sentenceId) {
    const [sentence] = await db.select({ id: sentences.id }).from(sentences).where(eq(sentences.id, input.sentenceId)).limit(1);
    if (!sentence) throw new HttpError(404, "NOT_FOUND", "Sentence not found");
  }

  let imageUrl: string | null = null;
  let imageStorageKey: string | null = null;
  if (input.image) {
    const ext = input.image.filename.includes(".") ? input.image.filename.split(".").pop() : "jpg";
    // Reuses the generic (no fixed crop ratio) uploader built for the
    // suggestion box -- a forum photo is exactly the same kind of asset:
    // reference material shown as-is, not a live corpus image that needs a
    // locked aspect ratio.
    const uploaded = await storageService.uploadSuggestionImage(input.image.buffer, `forum/${randomUUID()}.${ext}`);
    imageUrl = uploaded.publicUrl;
    imageStorageKey = uploaded.path;
  }

  const [post] = await db
    .insert(forumPosts)
    .values({
      authorId: userId,
      body: input.body,
      imageUrl,
      imageStorageKey,
      gifUrl: input.gifUrl ?? null,
      conceptId: input.conceptId ?? null,
      sentenceId: input.sentenceId ?? null,
    })
    .returning();

  return post!;
}

/** Concept/sentence preview rows for a batch of posts -- batched the same way as the reaction/comment counts below. */
async function attachmentsByPost(postRows: { id: string; conceptId: string | null; sentenceId: string | null }[]) {
  const conceptIds = [...new Set(postRows.map((p) => p.conceptId).filter((id): id is string => !!id))];
  const sentenceIds = [...new Set(postRows.map((p) => p.sentenceId).filter((id): id is string => !!id))];

  const [conceptRows, sentenceRows] = await Promise.all([
    conceptIds.length
      ? db
          .select({ id: concepts.id, labelEnglish: concepts.labelEnglish, imageUrl: conceptMedia.publicUrl })
          .from(concepts)
          .leftJoin(conceptMedia, and(eq(conceptMedia.conceptId, concepts.id), eq(conceptMedia.isPrimary, true)))
          .where(inArray(concepts.id, conceptIds))
      : [],
    sentenceIds.length
      ? db.select({ id: sentences.id, englishText: sentences.englishText }).from(sentences).where(inArray(sentences.id, sentenceIds))
      : [],
  ]);

  return {
    conceptById: new Map(conceptRows.map((c) => [c.id, c])),
    sentenceById: new Map(sentenceRows.map((s) => [s.id, s])),
  };
}

export async function listPosts(userId: string, limit: number, offset: number) {
  const whereClause = isNull(forumPosts.deletedAt);

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: forumPosts.id,
        body: forumPosts.body,
        imageUrl: forumPosts.imageUrl,
        gifUrl: forumPosts.gifUrl,
        conceptId: forumPosts.conceptId,
        sentenceId: forumPosts.sentenceId,
        createdAt: forumPosts.createdAt,
        author: AUTHOR_SELECT,
      })
      .from(forumPosts)
      .innerJoin(users, eq(users.id, forumPosts.authorId))
      .where(whereClause)
      .orderBy(desc(forumPosts.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(forumPosts).where(whereClause),
  ]);

  const postIds = rows.map((r) => r.id);
  const [reactionCounts, myReactions, commentCountRows, { conceptById, sentenceById }] = await Promise.all([
    countReactionsByTarget(forumPostReactions, forumPostReactions.postId, postIds),
    myReactionsByTarget(forumPostReactions, forumPostReactions.postId, forumPostReactions.userId, postIds, userId),
    postIds.length
      ? db
          .select({ postId: forumComments.postId, value: sql<number>`count(*)`.mapWith(Number) })
          .from(forumComments)
          .where(and(inArray(forumComments.postId, postIds), isNull(forumComments.deletedAt)))
          .groupBy(forumComments.postId)
      : [],
    attachmentsByPost(rows),
  ]);
  const commentCountByPost = new Map(commentCountRows.map((r) => [r.postId, r.value]));

  const items = rows.map((row) => ({
    id: row.id,
    body: row.body,
    imageUrl: row.imageUrl,
    gifUrl: row.gifUrl,
    author: row.author,
    createdAt: row.createdAt,
    concept: row.conceptId ? (conceptById.get(row.conceptId) ?? null) : null,
    sentence: row.sentenceId ? (sentenceById.get(row.sentenceId) ?? null) : null,
    reactionCounts: reactionCounts.get(row.id) ?? {},
    myReaction: myReactions.get(row.id) ?? null,
    commentCount: commentCountByPost.get(row.id) ?? 0,
  }));

  return { items, limit, offset, total: totalRow?.value ?? 0 };
}

/** A flat row list turned into a parent->children tree -- bounded to one post's own comments, never the whole table. */
function buildCommentTree<T extends { id: string; parentCommentId: string | null }>(rows: T[]): (T & { replies: unknown[] })[] {
  const byId = new Map(rows.map((r) => [r.id, { ...r, replies: [] as (T & { replies: unknown[] })[] }]));
  const roots: (T & { replies: unknown[] })[] = [];
  for (const row of byId.values()) {
    if (row.parentCommentId && byId.has(row.parentCommentId)) {
      byId.get(row.parentCommentId)!.replies.push(row);
    } else {
      roots.push(row);
    }
  }
  return roots;
}

export async function getPost(id: string, userId: string) {
  const [row] = await db
    .select({
      id: forumPosts.id,
      body: forumPosts.body,
      imageUrl: forumPosts.imageUrl,
      gifUrl: forumPosts.gifUrl,
      conceptId: forumPosts.conceptId,
      sentenceId: forumPosts.sentenceId,
      createdAt: forumPosts.createdAt,
      authorId: forumPosts.authorId,
      author: AUTHOR_SELECT,
    })
    .from(forumPosts)
    .innerJoin(users, eq(users.id, forumPosts.authorId))
    .where(and(eq(forumPosts.id, id), isNull(forumPosts.deletedAt)))
    .limit(1);

  if (!row) {
    throw new HttpError(404, "NOT_FOUND", "Post not found");
  }

  const [commentRows, [reactionCounts], [myReactions], { conceptById, sentenceById }] = await Promise.all([
    db
      .select({
        id: forumComments.id,
        parentCommentId: forumComments.parentCommentId,
        body: forumComments.body,
        gifUrl: forumComments.gifUrl,
        createdAt: forumComments.createdAt,
        authorId: forumComments.authorId,
        author: AUTHOR_SELECT,
      })
      .from(forumComments)
      .innerJoin(users, eq(users.id, forumComments.authorId))
      .where(and(eq(forumComments.postId, id), isNull(forumComments.deletedAt)))
      .orderBy(asc(forumComments.createdAt))
      .limit(500),
    countReactionsByTarget(forumPostReactions, forumPostReactions.postId, [id]).then((m) => [m.get(id) ?? {}]),
    myReactionsByTarget(forumPostReactions, forumPostReactions.postId, forumPostReactions.userId, [id], userId).then((m) => [
      m.get(id) ?? null,
    ]),
    attachmentsByPost([row]),
  ]);

  const commentIds = commentRows.map((c) => c.id);
  const [commentReactionCounts, myCommentReactions] = await Promise.all([
    countReactionsByTarget(forumCommentReactions, forumCommentReactions.commentId, commentIds),
    myReactionsByTarget(forumCommentReactions, forumCommentReactions.commentId, forumCommentReactions.userId, commentIds, userId),
  ]);

  const flatComments = commentRows.map((c) => ({
    id: c.id,
    parentCommentId: c.parentCommentId,
    body: c.body,
    gifUrl: c.gifUrl,
    createdAt: c.createdAt,
    author: c.author,
    reactionCounts: commentReactionCounts.get(c.id) ?? {},
    myReaction: myCommentReactions.get(c.id) ?? null,
  }));

  return {
    id: row.id,
    body: row.body,
    imageUrl: row.imageUrl,
    gifUrl: row.gifUrl,
    author: row.author,
    createdAt: row.createdAt,
    concept: row.conceptId ? (conceptById.get(row.conceptId) ?? null) : null,
    sentence: row.sentenceId ? (sentenceById.get(row.sentenceId) ?? null) : null,
    reactionCounts: reactionCounts[0],
    myReaction: myReactions[0],
    comments: buildCommentTree(flatComments),
  };
}

/** Author can delete their own; a moderator (users.manage) can delete anyone's -- the route checks that, this just applies it. */
export async function deletePost(id: string): Promise<void> {
  const result = await db.update(forumPosts).set({ deletedAt: new Date() }).where(eq(forumPosts.id, id)).returning({ id: forumPosts.id });
  if (result.length === 0) {
    throw new HttpError(404, "NOT_FOUND", "Post not found");
  }
}

export async function getPostAuthorId(id: string): Promise<string | null> {
  const [row] = await db.select({ authorId: forumPosts.authorId }).from(forumPosts).where(eq(forumPosts.id, id)).limit(1);
  return row?.authorId ?? null;
}

export async function createComment(
  userId: string,
  postId: string,
  input: { body: string; parentCommentId?: string; gifUrl?: string },
) {
  const [post] = await db.select({ id: forumPosts.id }).from(forumPosts).where(and(eq(forumPosts.id, postId), isNull(forumPosts.deletedAt))).limit(1);
  if (!post) {
    throw new HttpError(404, "NOT_FOUND", "Post not found");
  }

  if (input.parentCommentId) {
    const [parent] = await db
      .select({ id: forumComments.id })
      .from(forumComments)
      .where(and(eq(forumComments.id, input.parentCommentId), eq(forumComments.postId, postId), isNull(forumComments.deletedAt)))
      .limit(1);
    if (!parent) {
      throw new HttpError(404, "NOT_FOUND", "The comment you're replying to no longer exists");
    }
  }

  const [comment] = await db
    .insert(forumComments)
    .values({
      postId,
      authorId: userId,
      parentCommentId: input.parentCommentId ?? null,
      body: input.body,
      gifUrl: input.gifUrl ?? null,
    })
    .returning();

  return comment!;
}

export async function getCommentAuthorId(id: string): Promise<string | null> {
  const [row] = await db.select({ authorId: forumComments.authorId }).from(forumComments).where(eq(forumComments.id, id)).limit(1);
  return row?.authorId ?? null;
}

export async function deleteComment(id: string): Promise<void> {
  const result = await db
    .update(forumComments)
    .set({ deletedAt: new Date() })
    .where(eq(forumComments.id, id))
    .returning({ id: forumComments.id });
  if (result.length === 0) {
    throw new HttpError(404, "NOT_FOUND", "Comment not found");
  }
}

export async function setPostReaction(postId: string, userId: string, reactionType: ForumReactionType) {
  const [post] = await db.select({ id: forumPosts.id }).from(forumPosts).where(and(eq(forumPosts.id, postId), isNull(forumPosts.deletedAt))).limit(1);
  if (!post) throw new HttpError(404, "NOT_FOUND", "Post not found");

  await db
    .insert(forumPostReactions)
    .values({ postId, userId, reactionType })
    .onConflictDoUpdate({ target: [forumPostReactions.postId, forumPostReactions.userId], set: { reactionType } });
}

export async function removePostReaction(postId: string, userId: string): Promise<void> {
  await db.delete(forumPostReactions).where(and(eq(forumPostReactions.postId, postId), eq(forumPostReactions.userId, userId)));
}

export async function setCommentReaction(commentId: string, userId: string, reactionType: ForumReactionType) {
  const [comment] = await db
    .select({ id: forumComments.id })
    .from(forumComments)
    .where(and(eq(forumComments.id, commentId), isNull(forumComments.deletedAt)))
    .limit(1);
  if (!comment) throw new HttpError(404, "NOT_FOUND", "Comment not found");

  await db
    .insert(forumCommentReactions)
    .values({ commentId, userId, reactionType })
    .onConflictDoUpdate({ target: [forumCommentReactions.commentId, forumCommentReactions.userId], set: { reactionType } });
}

export async function removeCommentReaction(commentId: string, userId: string): Promise<void> {
  await db.delete(forumCommentReactions).where(and(eq(forumCommentReactions.commentId, commentId), eq(forumCommentReactions.userId, userId)));
}
