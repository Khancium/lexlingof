"use client";

import { api, type ForumPoll } from "@/lib/api";

/** Poll results/voting UI -- a post "is a poll" purely by having a non-null `poll`. Voting swaps the caller's own option in place; clicking the active option retracts the vote. */
export function ForumPollView({ postId, poll, onVoted }: { postId: string; poll: ForumPoll; onVoted: () => void }) {
  async function handlePick(optionId: string) {
    if (poll.myOptionId === optionId) {
      await api.forum.removePollVote(postId);
    } else {
      await api.forum.votePoll(postId, optionId);
    }
    onVoted();
  }

  return (
    <div className="space-y-1.5">
      {poll.options.map((option) => {
        const pct = poll.totalVotes > 0 ? Math.round((option.voteCount / poll.totalVotes) * 100) : 0;
        const isMine = poll.myOptionId === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => handlePick(option.id)}
            className={`relative block w-full overflow-hidden rounded-lg px-3 py-2 text-left text-sm ring-1 ${
              isMine ? "ring-2 ring-brand" : "ring-border"
            }`}
          >
            <div className="absolute inset-y-0 left-0 bg-brand-light" style={{ width: `${pct}%` }} />
            <div className="relative flex items-center justify-between gap-2">
              <span className={isMine ? "font-semibold text-ink" : "text-ink"}>{option.label}</span>
              <span className="shrink-0 text-xs text-ink-muted">
                {pct}% ({option.voteCount})
              </span>
            </div>
          </button>
        );
      })}
      <p className="text-xs text-ink-muted">
        {poll.totalVotes} vote{poll.totalVotes === 1 ? "" : "s"}
      </p>
    </div>
  );
}
