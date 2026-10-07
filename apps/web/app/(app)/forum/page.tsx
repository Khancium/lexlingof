"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { api, getErrorMessage, type ForumPost } from "@/lib/api";
import { ForumPostComposer, type ForumAnchor } from "@/components/forum-post-composer";
import { ForumReactionBar } from "@/components/forum-reaction-bar";
import { ForumPollView } from "@/components/forum-poll";
import { Pagination } from "@/components/admin-pagination";

const PAGE_SIZE = 20;

export default function ForumPage() {
  return (
    <Suspense fallback={<p className="text-ink-muted">Loading...</p>}>
      <ForumPageInner />
    </Suspense>
  );
}

function ForumPageInner() {
  const searchParams = useSearchParams();
  const conceptId = searchParams.get("conceptId");
  const sentenceId = searchParams.get("sentenceId");

  const [anchor, setAnchor] = useState<ForumAnchor | undefined>(undefined);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (conceptId) {
      api.concepts
        .getById(conceptId)
        .then((concept) =>
          setAnchor({
            type: "concept",
            concept: { id: concept.id, labelEnglish: concept.labelEnglish, imageUrl: concept.media.find((m) => m.isPrimary)?.publicUrl ?? null },
          }),
        )
        .catch(() => setAnchor(undefined));
    } else if (sentenceId) {
      api.contributions
        .getSentenceById(sentenceId)
        .then((sentence) => setAnchor({ type: "sentence", sentence: { id: sentence.id, englishText: sentence.englishText } }))
        .catch(() => setAnchor(undefined));
    } else {
      setAnchor(undefined);
    }
  }, [conceptId, sentenceId]);

  function load() {
    setLoading(true);
    setError(null);
    api.forum
      .getPosts({ limit: PAGE_SIZE, offset })
      .then((res) => {
        setPosts(res.items);
        setTotal(res.total);
      })
      .catch((err) => setError(getErrorMessage(err, "Failed to load the forum")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  async function handleReact(postId: string, reactionType: Parameters<typeof api.forum.setPostReaction>[1]) {
    await api.forum.setPostReaction(postId, reactionType);
    load();
  }

  async function handleUnreact(postId: string) {
    await api.forum.removePostReaction(postId);
    load();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-ink">Forum</h1>
      <p className="text-sm text-ink-muted">
        An open space for every contributor -- ask questions, discuss objects and sentences from the corpus, or just chat.
      </p>

      <ForumPostComposer anchor={anchor} onPosted={() => (offset === 0 ? load() : setOffset(0))} />

      {error ? <p className="text-red-600">{error}</p> : null}

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : posts.length === 0 ? (
        <p className="text-ink-muted">No posts yet -- be the first to start a discussion.</p>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <div key={post.id} className="card-duo space-y-3 rounded-2xl bg-surface p-4 shadow-sm">
              <div className="flex items-center gap-2">
                {post.author.avatarUrl ? (
                  <Image src={post.author.avatarUrl} alt="" width={32} height={32} className="h-8 w-8 rounded-full object-cover" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-light text-sm font-bold text-brand-dark">
                    {post.author.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-ink">{post.author.displayName}</p>
                  <p className="text-xs text-ink-muted">{new Date(post.createdAt).toLocaleString()}</p>
                </div>
              </div>

              <p className="whitespace-pre-wrap text-ink">{post.body}</p>

              {post.concept ? (
                <div className="flex items-center gap-3 rounded-xl bg-surface-card p-3 text-sm">
                  {post.concept.imageUrl ? (
                    <Image
                      src={post.concept.imageUrl}
                      alt=""
                      width={96}
                      height={96}
                      className="h-20 w-20 shrink-0 rounded-lg object-cover"
                    />
                  ) : null}
                  <div>
                    <span className="text-ink-muted">Discussing: </span>
                    <span className="text-base font-semibold text-ink">{post.concept.labelEnglish}</span>
                  </div>
                </div>
              ) : null}
              {post.sentence ? (
                <div className="rounded-xl bg-surface-card p-3 text-sm">
                  <span className="text-ink-muted">Discussing: </span>
                  <span className="text-base font-semibold text-ink">&quot;{post.sentence.englishText}&quot;</span>
                </div>
              ) : null}

              {post.imageUrl ? (
                <div className="flex max-h-96 w-full items-center justify-center overflow-hidden rounded-xl bg-surface-card">
                  <Image
                    src={post.imageUrl}
                    alt=""
                    width={700}
                    height={400}
                    sizes="100vw"
                    className="max-h-96 w-full object-contain"
                  />
                </div>
              ) : null}
              {post.poll ? <ForumPollView postId={post.id} poll={post.poll} onVoted={load} /> : null}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <ForumReactionBar
                  reactionCounts={post.reactionCounts}
                  myReaction={post.myReaction}
                  onReact={(type) => handleReact(post.id, type)}
                  onUnreact={() => handleUnreact(post.id)}
                />
                <Link href={`/forum/${post.id}`} className="text-sm font-semibold text-brand hover:underline">
                  {post.commentCount > 0 ? `${post.commentCount} comment${post.commentCount === 1 ? "" : "s"}` : "Comment"}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && <Pagination offset={offset} limit={PAGE_SIZE} total={total} onChange={setOffset} showPageNumbers />}
    </div>
  );
}
