import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { hasPermission, verifyToken } from "../../middleware/auth.js";
import { HttpError } from "../../utils/http-error.js";
import {
  createComment,
  createPost,
  deleteComment,
  deletePost,
  getCommentAuthorId,
  getPost,
  getPostAuthorId,
  listPosts,
  removeCommentReaction,
  removePollVote,
  removePostReaction,
  setCommentReaction,
  setPostReaction,
  votePoll,
  type ForumReactionType,
} from "./forum.service.js";

const REACTION_TYPES = ["like", "dislike", "laugh", "love", "wow", "sad", "angry"] as const;
const MAX_FORUM_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

const idParamSchema = z.object({ id: z.string().uuid() });
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  parentCommentId: z.string().uuid().optional(),
});
const reactionSchema = z.object({ reactionType: z.enum(REACTION_TYPES) });
const voteSchema = z.object({ optionId: z.string().uuid() });

const createPostFieldsSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  conceptId: z.string().uuid().optional(),
  sentenceId: z.string().uuid().optional(),
  // JSON-encoded string[] of 2-6 poll option labels, sent as a regular
  // multipart field alongside the rest of the composer's fields.
  pollOptions: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (!raw) return undefined;
      try {
        const parsed = JSON.parse(raw);
        return z.array(z.string().trim().min(1).max(120)).min(2).max(6).parse(parsed);
      } catch {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid pollOptions" });
        return z.NEVER;
      }
    }),
});

/**
 * The post composer always posts multipart (even with no image attached),
 * same reasoning and same pattern as readSuggestionSubmission in
 * users.routes.ts -- iterating request.parts() directly is what lets the
 * image stay optional, since request.file() has no defined behavior for a
 * multipart body with zero file parts.
 */
async function readPostSubmission(
  request: FastifyRequest,
): Promise<z.infer<typeof createPostFieldsSchema> & { image?: { buffer: Buffer; filename: string } }> {
  const fields: Record<string, string> = {};
  let image: { buffer: Buffer; filename: string } | undefined;

  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (!part.mimetype.startsWith("image/")) {
        throw new HttpError(400, "INVALID_FILE_TYPE", "Only image files are accepted");
      }
      const buffer = await part.toBuffer();
      if (buffer.byteLength > MAX_FORUM_IMAGE_BYTES) {
        throw new HttpError(400, "FILE_TOO_LARGE", `Image exceeds the ${MAX_FORUM_IMAGE_BYTES} byte limit`);
      }
      image = { buffer, filename: part.filename };
    } else if (part.type === "field") {
      fields[part.fieldname] = String(part.value);
    }
  }

  const body = createPostFieldsSchema.parse(fields);
  return { ...body, image };
}

export default async function forumRoutes(fastify: FastifyInstance) {
  fastify.get("/posts", { preHandler: verifyToken }, async (request) => {
    const { limit, offset } = listQuerySchema.parse(request.query);
    return listPosts(request.user!.id, limit, offset);
  });

  fastify.post("/posts", { preHandler: verifyToken }, async (request, reply) => {
    const { body, conceptId, sentenceId, pollOptions, image } = await readPostSubmission(request);
    const post = await createPost(request.user!.id, { body, conceptId, sentenceId, pollOptions, image });
    reply.code(201).send(post);
  });

  fastify.get("/posts/:id", { preHandler: verifyToken }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    return getPost(id, request.user!.id);
  });

  fastify.delete("/posts/:id", { preHandler: verifyToken }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const actor = request.user!;
    const authorId = await getPostAuthorId(id);
    if (!authorId) {
      throw new HttpError(404, "NOT_FOUND", "Post not found");
    }
    // Own post, or a moderator (same permission that already gates
    // suspending/restricting users) acting on anyone's.
    if (authorId !== actor.id && !(await hasPermission(actor.role, "users.manage"))) {
      throw new HttpError(403, "FORBIDDEN", "You can only delete your own posts");
    }
    await deletePost(id);
    return { id, deleted: true };
  });

  fastify.post("/posts/:id/comments", { preHandler: verifyToken }, async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const body = createCommentSchema.parse(request.body);
    const comment = await createComment(request.user!.id, id, body);
    reply.code(201).send(comment);
  });

  fastify.delete("/comments/:id", { preHandler: verifyToken }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const actor = request.user!;
    const authorId = await getCommentAuthorId(id);
    if (!authorId) {
      throw new HttpError(404, "NOT_FOUND", "Comment not found");
    }
    if (authorId !== actor.id && !(await hasPermission(actor.role, "users.manage"))) {
      throw new HttpError(403, "FORBIDDEN", "You can only delete your own comments");
    }
    await deleteComment(id);
    return { id, deleted: true };
  });

  // Reactions: PUT sets/replaces the caller's own reaction on this
  // post/comment (one live reaction per user, enforced by the table's
  // unique index); DELETE clears it. The frontend treats clicking an
  // already-active reaction as "remove" and any other reaction as "set".
  fastify.put("/posts/:id/reaction", { preHandler: verifyToken }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { reactionType } = reactionSchema.parse(request.body);
    await setPostReaction(id, request.user!.id, reactionType as ForumReactionType);
    return { id, reactionType };
  });

  fastify.delete("/posts/:id/reaction", { preHandler: verifyToken }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await removePostReaction(id, request.user!.id);
    return { id, reactionType: null };
  });

  fastify.put("/comments/:id/reaction", { preHandler: verifyToken }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { reactionType } = reactionSchema.parse(request.body);
    await setCommentReaction(id, request.user!.id, reactionType as ForumReactionType);
    return { id, reactionType };
  });

  fastify.delete("/comments/:id/reaction", { preHandler: verifyToken }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await removeCommentReaction(id, request.user!.id);
    return { id, reactionType: null };
  });

  // Poll voting: PUT sets/replaces the caller's own vote on this poll (one
  // live vote per user, enforced by the forum_poll_votes unique index);
  // DELETE retracts it.
  fastify.put("/posts/:id/poll/vote", { preHandler: verifyToken }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    const { optionId } = voteSchema.parse(request.body);
    await votePoll(id, request.user!.id, optionId);
    return { id, optionId };
  });

  fastify.delete("/posts/:id/poll/vote", { preHandler: verifyToken }, async (request) => {
    const { id } = idParamSchema.parse(request.params);
    await removePollVote(id, request.user!.id);
    return { id, optionId: null };
  });
}
