import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "../../db/index.js";
import {
  concepts,
  conceptMedia,
  forumCommentReactions,
  forumComments,
  forumPollOptions,
  forumPollVotes,
  forumPostReactions,
  forumPosts,
  notifications,
  sentences,
  users,
} from "../../db/schema.js";
import { sendPushToUser } from "../notifications/push.service.js";
import { storageService } from "../../services/storage.service.js";
import { HttpError } from "../../utils/http-error.js";

/**
 * Shared by every forum action below that reaches another user (a comment,
 * reply, or reaction) -- persists an in-app row the same way every other
 * notification type does, then best-effort pushes it (a failed push never
 * blocks the underlying forum action, same pattern as gamification's badge
 * push). Silently a no-op when the recipient is the actor themself, e.g.
 * commenting on or reacting to your own post -- nobody needs to be told
 * about their own activity.
 */
async function notifyForumActivity(params: {
  recipientId: string;
  actorId: string;
  notificationType: string;
  title: string;
  body: string;
  data: Record<string, string>;
}): Promise<void> {
  if (params.recipientId === params.actorId) return;

  await db.insert(notifications).values({
    userId: params.recipientId,
    channel: "push",
    notificationType: params.notificationType,
    title: params.title,
    body: params.body,
    data: params.data,
  });

  try {
    await sendPushToUser(params.recipientId, params.title, params.body, params.data);
  } catch (err) {
    console.error(`[forum] push notification failed (${params.notificationType}):`, err);
  }
}

/** Trims a comment/post body down to something that fits in a push notification. */
function snippet(body: string, maxLength = 100): string {
  const trimmed = body.trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

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
  /** 2-6 option labels. A post becomes a poll purely by having these rows. */
  pollOptions?: string[];
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
  if (input.pollOptions && (input.pollOptions.length < 2 || input.pollOptions.length > 6)) {
    throw new HttpError(400, "INVALID_POLL", "A poll needs between 2 and 6 options");
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

  return db.transaction(async (tx) => {
    const [post] = await tx
      .insert(forumPosts)
      .values({
        authorId: userId,
        body: input.body,
        imageUrl,
        imageStorageKey,
        conceptId: input.conceptId ?? null,
        sentenceId: input.sentenceId ?? null,
      })
      .returning();

    if (input.pollOptions?.length) {
      await tx.insert(forumPollOptions).values(
        input.pollOptions.map((label, index) => ({ postId: post!.id, label, sortOrder: index })),
      );
    }

    return post!;
  });
}

/** Poll options + vote counts + the caller's own vote, batched across every post that has any. */
async function pollsByPost(postIds: string[], userId: string) {
  if (postIds.length === 0) return new Map<string, { options: { id: string; label: string; voteCount: number }[]; totalVotes: number; myOptionId: string | null }>();

  const [optionRows, voteCountRows, myVoteRows] = await Promise.all([
    db
      .select({ id: forumPollOptions.id, postId: forumPollOptions.postId, label: forumPollOptions.label })
      .from(forumPollOptions)
      .where(inArray(forumPollOptions.postId, postIds))
      .orderBy(asc(forumPollOptions.sortOrder)),
    db
      .select({ optionId: forumPollVotes.optionId, value: sql<number>`count(*)`.mapWith(Number) })
      .from(forumPollVotes)
      .where(inArray(forumPollVotes.postId, postIds))
      .groupBy(forumPollVotes.optionId),
    db
      .select({ postId: forumPollVotes.postId, optionId: forumPollVotes.optionId })
      .from(forumPollVotes)
      .where(and(inArray(forumPollVotes.postId, postIds), eq(forumPollVotes.userId, userId))),
  ]);

  const voteCountByOption = new Map(voteCountRows.map((r) => [r.optionId, r.value]));
  const myOptionByPost = new Map(myVoteRows.map((r) => [r.postId, r.optionId]));

  const byPost = new Map<string, { options: { id: string; label: string; voteCount: number }[]; totalVotes: number; myOptionId: string | null }>();
  for (const row of optionRows) {
    const poll = byPost.get(row.postId) ?? { options: [], totalVotes: 0, myOptionId: myOptionByPost.get(row.postId) ?? null };
    const voteCount = voteCountByOption.get(row.id) ?? 0;
    poll.options.push({ id: row.id, label: row.label, voteCount });
    poll.totalVotes += voteCount;
    byPost.set(row.postId, poll);
  }
  return byPost;
}

export async function votePoll(postId: string, userId: string, optionId: string): Promise<void> {
  const [option] = await db
    .select({ id: forumPollOptions.id })
    .from(forumPollOptions)
    .where(and(eq(forumPollOptions.id, optionId), eq(forumPollOptions.postId, postId)))
    .limit(1);
  if (!option) throw new HttpError(404, "NOT_FOUND", "Poll option not found");

  await db
    .insert(forumPollVotes)
    .values({ postId, optionId, userId })
    .onConflictDoUpdate({ target: [forumPollVotes.postId, forumPollVotes.userId], set: { optionId } });
}

export async function removePollVote(postId: string, userId: string): Promise<void> {
  await db.delete(forumPollVotes).where(and(eq(forumPollVotes.postId, postId), eq(forumPollVotes.userId, userId)));
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
  const [reactionCounts, myReactions, commentCountRows, { conceptById, sentenceById }, polls] = await Promise.all([
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
    pollsByPost(postIds, userId),
  ]);
  const commentCountByPost = new Map(commentCountRows.map((r) => [r.postId, r.value]));

  const items = rows.map((row) => ({
    id: row.id,
    body: row.body,
    imageUrl: row.imageUrl,
    author: row.author,
    createdAt: row.createdAt,
    concept: row.conceptId ? (conceptById.get(row.conceptId) ?? null) : null,
    sentence: row.sentenceId ? (sentenceById.get(row.sentenceId) ?? null) : null,
    reactionCounts: reactionCounts.get(row.id) ?? {},
    myReaction: myReactions.get(row.id) ?? null,
    commentCount: commentCountByPost.get(row.id) ?? 0,
    poll: polls.get(row.id) ?? null,
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

  const [commentRows, [reactionCounts], [myReactions], { conceptById, sentenceById }, polls] = await Promise.all([
    db
      .select({
        id: forumComments.id,
        parentCommentId: forumComments.parentCommentId,
        body: forumComments.body,
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
    pollsByPost([id], userId),
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
    createdAt: c.createdAt,
    author: c.author,
    reactionCounts: commentReactionCounts.get(c.id) ?? {},
    myReaction: myCommentReactions.get(c.id) ?? null,
  }));

  return {
    id: row.id,
    body: row.body,
    imageUrl: row.imageUrl,
    author: row.author,
    createdAt: row.createdAt,
    concept: row.conceptId ? (conceptById.get(row.conceptId) ?? null) : null,
    sentence: row.sentenceId ? (sentenceById.get(row.sentenceId) ?? null) : null,
    reactionCounts: reactionCounts ?? {},
    myReaction: myReactions ?? null,
    poll: polls.get(id) ?? null,
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
  input: { body: string; parentCommentId?: string },
) {
  const [post] = await db
    .select({ id: forumPosts.id, authorId: forumPosts.authorId })
    .from(forumPosts)
    .where(and(eq(forumPosts.id, postId), isNull(forumPosts.deletedAt)))
    .limit(1);
  if (!post) {
    throw new HttpError(404, "NOT_FOUND", "Post not found");
  }

  let parentAuthorId: string | null = null;
  if (input.parentCommentId) {
    const [parent] = await db
      .select({ id: forumComments.id, authorId: forumComments.authorId })
      .from(forumComments)
      .where(and(eq(forumComments.id, input.parentCommentId), eq(forumComments.postId, postId), isNull(forumComments.deletedAt)))
      .limit(1);
    if (!parent) {
      throw new HttpError(404, "NOT_FOUND", "The comment you're replying to no longer exists");
    }
    parentAuthorId = parent.authorId;
  }

  const [comment] = await db
    .insert(forumComments)
    .values({
      postId,
      authorId: userId,
      parentCommentId: input.parentCommentId ?? null,
      body: input.body,
    })
    .returning();

  const [actor] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId)).limit(1);
  const actorName = actor?.displayName ?? "Someone";

  // A reply notifies the comment it replies to, not also the post author --
  // keeps a busy reply thread from double-notifying the same person once
  // per reply. A top-level comment notifies the post author.
  if (parentAuthorId) {
    await notifyForumActivity({
      recipientId: parentAuthorId,
      actorId: userId,
      notificationType: "FORUM_REPLY",
      title: `${actorName} replied to your comment`,
      body: snippet(input.body),
      data: { postId, commentId: comment!.id },
    });
  } else {
    await notifyForumActivity({
      recipientId: post.authorId,
      actorId: userId,
      notificationType: "FORUM_COMMENT",
      title: `${actorName} commented on your post`,
      body: snippet(input.body),
      data: { postId, commentId: comment!.id },
    });
  }

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
  const [post] = await db
    .select({ id: forumPosts.id, authorId: forumPosts.authorId })
    .from(forumPosts)
    .where(and(eq(forumPosts.id, postId), isNull(forumPosts.deletedAt)))
    .limit(1);
  if (!post) throw new HttpError(404, "NOT_FOUND", "Post not found");

  // Only the first reaction from this user notifies -- switching which
  // emoji they picked (still the same upsert) doesn't re-notify the author.
  const [existing] = await db
    .select({ id: forumPostReactions.id })
    .from(forumPostReactions)
    .where(and(eq(forumPostReactions.postId, postId), eq(forumPostReactions.userId, userId)))
    .limit(1);

  await db
    .insert(forumPostReactions)
    .values({ postId, userId, reactionType })
    .onConflictDoUpdate({ target: [forumPostReactions.postId, forumPostReactions.userId], set: { reactionType } });

  if (!existing) {
    const [actor] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId)).limit(1);
    await notifyForumActivity({
      recipientId: post.authorId,
      actorId: userId,
      notificationType: "FORUM_REACTION",
      title: `${actor?.displayName ?? "Someone"} reacted to your post`,
      body: "Tap to see the reaction.",
      data: { postId },
    });
  }
}

export async function removePostReaction(postId: string, userId: string): Promise<void> {
  await db.delete(forumPostReactions).where(and(eq(forumPostReactions.postId, postId), eq(forumPostReactions.userId, userId)));
}

export async function setCommentReaction(commentId: string, userId: string, reactionType: ForumReactionType) {
  const [comment] = await db
    .select({ id: forumComments.id, authorId: forumComments.authorId, postId: forumComments.postId })
    .from(forumComments)
    .where(and(eq(forumComments.id, commentId), isNull(forumComments.deletedAt)))
    .limit(1);
  if (!comment) throw new HttpError(404, "NOT_FOUND", "Comment not found");

  const [existing] = await db
    .select({ id: forumCommentReactions.id })
    .from(forumCommentReactions)
    .where(and(eq(forumCommentReactions.commentId, commentId), eq(forumCommentReactions.userId, userId)))
    .limit(1);

  await db
    .insert(forumCommentReactions)
    .values({ commentId, userId, reactionType })
    .onConflictDoUpdate({ target: [forumCommentReactions.commentId, forumCommentReactions.userId], set: { reactionType } });

  if (!existing) {
    const [actor] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, userId)).limit(1);
    await notifyForumActivity({
      recipientId: comment.authorId,
      actorId: userId,
      notificationType: "FORUM_REACTION",
      title: `${actor?.displayName ?? "Someone"} reacted to your comment`,
      body: "Tap to see the reaction.",
      data: { postId: comment.postId, commentId },
    });
  }
}

export async function removeCommentReaction(commentId: string, userId: string): Promise<void> {
  await db.delete(forumCommentReactions).where(and(eq(forumCommentReactions.commentId, commentId), eq(forumCommentReactions.userId, userId)));
}
