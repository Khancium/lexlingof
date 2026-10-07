"use client";

import { useState } from "react";
import { api, getErrorMessage, type ForumComment } from "@/lib/api";
import { ForumReactionBar } from "@/components/forum-reaction-bar";
import { EmojiPicker } from "@/components/emoji-picker";

// Caps visual indentation so a very deep reply chain doesn't push text off
// the right edge on a phone -- replies past this depth still nest logically
// (parentCommentId keeps incrementing) but stop indenting further.
const MAX_INDENT_DEPTH = 4;

export function ForumCommentThread({
  comment,
  postId,
  depth,
  currentUserId,
  onRefresh,
}: {
  comment: ForumComment;
  postId: string;
  depth: number;
  currentUserId: string | undefined;
  onRefresh: () => void;
}) {
  const [replying, setReplying] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function submitReply() {
    if (replyBody.trim().length === 0) return;
    setIsSubmittingReply(true);
    setReplyError(null);
    try {
      await api.forum.createComment(postId, { body: replyBody.trim(), parentCommentId: comment.id });
      setReplyBody("");
      setReplying(false);
      onRefresh();
    } catch (err) {
      setReplyError(getErrorMessage(err, "Failed to post reply"));
    } finally {
      setIsSubmittingReply(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this comment?")) return;
    setIsDeleting(true);
    try {
      await api.forum.deleteComment(comment.id);
      onRefresh();
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleReact(reactionType: Parameters<typeof api.forum.setCommentReaction>[1]) {
    await api.forum.setCommentReaction(comment.id, reactionType);
    onRefresh();
  }

  async function handleUnreact() {
    await api.forum.removeCommentReaction(comment.id);
    onRefresh();
  }

  return (
    <div style={{ marginLeft: Math.min(depth, MAX_INDENT_DEPTH) * 20 }}>
      <div className="rounded-xl bg-surface-card p-3">
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <span className="font-semibold text-ink">{comment.author.displayName}</span>
          <span>{new Date(comment.createdAt).toLocaleString()}</span>
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{comment.body}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <ForumReactionBar size="sm" reactionCounts={comment.reactionCounts} myReaction={comment.myReaction} onReact={handleReact} onUnreact={handleUnreact} />
          <button type="button" onClick={() => setReplying((v) => !v)} className="text-xs font-semibold text-ink-muted hover:underline">
            Reply
          </button>
          {comment.author.id === currentUserId ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          ) : null}
        </div>

        {replying ? (
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <input
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitReply();
                }}
                placeholder={`Reply to ${comment.author.displayName}...`}
                autoFocus
                className="flex-1 rounded-lg bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border"
              />
              <EmojiPicker onSelect={(emoji) => setReplyBody((prev) => prev + emoji)} />
              <button
                type="button"
                onClick={submitReply}
                disabled={isSubmittingReply || replyBody.trim().length === 0}
                className="btn-duo bg-brand px-3 py-1.5 text-xs font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
              >
                Reply
              </button>
            </div>
            {replyError ? <p className="text-xs text-red-600">{replyError}</p> : null}
          </div>
        ) : null}
      </div>

      {comment.replies.length > 0 ? (
        <div className="mt-2 space-y-2">
          {comment.replies.map((reply) => (
            <ForumCommentThread
              key={reply.id}
              comment={reply}
              postId={postId}
              depth={depth + 1}
              currentUserId={currentUserId}
              onRefresh={onRefresh}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
