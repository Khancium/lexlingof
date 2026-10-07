"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { api, getErrorMessage, type ForumPostDetail } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { ForumReactionBar } from "@/components/forum-reaction-bar";
import { ForumCommentThread } from "@/components/forum-comment-thread";
import { EmojiPicker } from "@/components/emoji-picker";
import { GifAttachInput } from "@/components/gif-attach-input";

export default function ForumPostPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const userId = useAuthStore((s) => s.user?.id);

  const [post, setPost] = useState<ForumPostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [commentBody, setCommentBody] = useState("");
  const [commentGifUrl, setCommentGifUrl] = useState("");
  const [isCommenting, setIsCommenting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [isDeletingPost, setIsDeletingPost] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.forum
      .getPost(params.id)
      .then(setPost)
      .catch((err) => setError(getErrorMessage(err, "Failed to load this post")))
      .finally(() => setLoading(false));
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handlePostComment() {
    if (commentBody.trim().length === 0) return;
    setIsCommenting(true);
    setCommentError(null);
    try {
      await api.forum.createComment(params.id, { body: commentBody.trim(), gifUrl: commentGifUrl || undefined });
      setCommentBody("");
      setCommentGifUrl("");
      load();
    } catch (err) {
      setCommentError(getErrorMessage(err, "Failed to post comment"));
    } finally {
      setIsCommenting(false);
    }
  }

  async function handleReact(reactionType: Parameters<typeof api.forum.setPostReaction>[1]) {
    await api.forum.setPostReaction(params.id, reactionType);
    load();
  }

  async function handleUnreact() {
    await api.forum.removePostReaction(params.id);
    load();
  }

  async function handleDeletePost() {
    if (!confirm("Delete this post? This cannot be undone.")) return;
    setIsDeletingPost(true);
    try {
      await api.forum.deletePost(params.id);
      router.push("/forum");
    } finally {
      setIsDeletingPost(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link href="/forum" className="btn-duo btn-duo-secondary inline-block bg-surface-card px-3 py-1.5 text-xs font-medium text-ink hover:bg-border">
        ← Back to Forum
      </Link>

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : error || !post ? (
        <p className="text-red-600">{error ?? "Post not found"}</p>
      ) : (
        <>
          <div className="card-duo space-y-3 rounded-2xl bg-surface p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                {post.author.avatarUrl ? (
                  <Image src={post.author.avatarUrl} alt="" width={36} height={36} className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-light text-sm font-bold text-brand-dark">
                    {post.author.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-ink">{post.author.displayName}</p>
                  <p className="text-xs text-ink-muted">{new Date(post.createdAt).toLocaleString()}</p>
                </div>
              </div>
              {post.author.id === userId ? (
                <button
                  type="button"
                  onClick={handleDeletePost}
                  disabled={isDeletingPost}
                  className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
                >
                  {isDeletingPost ? "Deleting..." : "Delete"}
                </button>
              ) : null}
            </div>

            <p className="whitespace-pre-wrap text-ink">{post.body}</p>

            {post.concept ? (
              <div className="flex items-center gap-2 rounded-lg bg-surface-card px-3 py-2 text-sm">
                {post.concept.imageUrl ? (
                  <Image src={post.concept.imageUrl} alt="" width={32} height={32} className="h-8 w-8 rounded object-cover" />
                ) : null}
                <span className="text-ink-muted">Discussing: </span>
                <span className="font-medium text-ink">{post.concept.labelEnglish}</span>
              </div>
            ) : null}
            {post.sentence ? (
              <div className="rounded-lg bg-surface-card px-3 py-2 text-sm">
                <span className="text-ink-muted">Discussing: </span>
                <span className="font-medium text-ink">&quot;{post.sentence.englishText}&quot;</span>
              </div>
            ) : null}

            {post.imageUrl ? (
              <Image src={post.imageUrl} alt="" width={700} height={380} sizes="100vw" className="max-h-96 w-full rounded-xl object-cover" />
            ) : null}
            {post.gifUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary third-party GIF URL
              <img src={post.gifUrl} alt="" className="max-h-96 w-full rounded-xl object-cover" />
            ) : null}

            <ForumReactionBar reactionCounts={post.reactionCounts} myReaction={post.myReaction} onReact={handleReact} onUnreact={handleUnreact} />
          </div>

          <div className="card-duo space-y-3 rounded-2xl bg-surface p-4 shadow-sm">
            <h2 className="text-sm font-bold uppercase tracking-wide text-ink-muted">
              {post.comments.length > 0 ? `${post.comments.length} comment${post.comments.length === 1 ? "" : "s"}` : "Comments"}
            </h2>

            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handlePostComment();
                  }}
                  placeholder="Write a comment..."
                  className="flex-1 rounded-lg bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border"
                />
                <EmojiPicker onSelect={(emoji) => setCommentBody((prev) => prev + emoji)} />
                <button
                  type="button"
                  onClick={handlePostComment}
                  disabled={isCommenting || commentBody.trim().length === 0}
                  className="btn-duo bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
                >
                  {isCommenting ? "Posting..." : "Comment"}
                </button>
              </div>
              <GifAttachInput value={commentGifUrl} onChange={setCommentGifUrl} />
              {commentError ? <p className="text-sm text-red-600">{commentError}</p> : null}
            </div>

            {post.comments.length === 0 ? (
              <p className="text-sm text-ink-muted">No comments yet -- start the discussion.</p>
            ) : (
              <div className="space-y-2">
                {post.comments.map((comment) => (
                  <ForumCommentThread key={comment.id} comment={comment} postId={params.id} depth={0} currentUserId={userId} onRefresh={load} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
