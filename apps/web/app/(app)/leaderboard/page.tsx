"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/lib/store";
import { api, type LeaderboardRow } from "@/lib/api";
import { LEVEL_COLOR } from "@/lib/level";

const PODIUM_STYLE: Record<1 | 2 | 3, { medal: string; height: string; ring: string; badge: string }> = {
  1: { medal: "🥇", height: "h-40 sm:h-48", ring: "ring-4 ring-yellow-400", badge: "bg-yellow-400 text-yellow-950" },
  2: { medal: "🥈", height: "h-32 sm:h-40", ring: "ring-4 ring-slate-300", badge: "bg-slate-300 text-slate-800" },
  3: { medal: "🥉", height: "h-28 sm:h-32", ring: "ring-4 ring-amber-600", badge: "bg-amber-600 text-white" },
};

function Initials({ name }: { name: string }) {
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-card text-xl font-bold text-ink-muted sm:h-16 sm:w-16">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function PodiumSlot({ row, place, isMe }: { row: LeaderboardRow; place: 1 | 2 | 3; isMe: boolean }) {
  const style = PODIUM_STYLE[place];
  return (
    <div className={`flex flex-col items-center gap-2 ${place === 1 ? "order-2" : place === 2 ? "order-1" : "order-3"}`}>
      <div className="relative">
        <div className={`rounded-full ${style.ring} ${isMe ? "animate-duo-pop" : ""}`}>
          <Initials name={row.displayName} />
        </div>
        <span className="absolute -bottom-1 -right-1 text-2xl">{style.medal}</span>
      </div>
      <p className="max-w-[100px] truncate text-center text-sm font-bold text-ink">{row.displayName}</p>
      <span className={`rounded-full px-2 py-0.5 text-xs font-bold text-white ${LEVEL_COLOR[row.level]}`}>{row.level}</span>
      <p className="text-sm font-semibold text-ink">⚡ {row.totalPoints.toLocaleString()}</p>
      <div
        className={`flex w-24 sm:w-28 flex-col items-center justify-start rounded-t-xl pt-2 ${style.height} ${
          place === 1 ? "bg-yellow-400/30" : place === 2 ? "bg-slate-300/30" : "bg-amber-600/20"
        }`}
      >
        <span className="text-3xl font-black text-ink/70">#{row.rank}</span>
      </div>
    </div>
  );
}

export default function LeaderboardPage() {
  const currentUser = useAuthStore((state) => state.user);
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.leaderboard.getGlobal({ limit: 100 }).then((res) => {
      setRows(res);
      setLoading(false);
    });
  }, []);

  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Leaderboard</h1>

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : (
        <>
          {top3.length > 0 ? (
            <div className="card-duo flex items-end justify-center gap-4 rounded-2xl bg-surface p-6 pb-0 shadow-sm sm:gap-8">
              {top3.map((row) => (
                <PodiumSlot key={row.userId} row={row} place={row.rank as 1 | 2 | 3} isMe={row.userId === currentUser?.id} />
              ))}
            </div>
          ) : null}

          {rest.length > 0 ? (
            <div className="card-duo overflow-x-auto rounded-2xl bg-surface shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-ink-muted">
                  <tr>
                    <th className="px-4 py-3">Rank</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Level</th>
                    <th className="px-4 py-3">Points</th>
                    <th className="px-4 py-3">Verified</th>
                    <th className="px-4 py-3">Streak</th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map((row) => {
                    const isMe = row.userId === currentUser?.id;
                    return (
                      <tr
                        key={row.userId}
                        className={`border-b border-border last:border-0 ${isMe ? "bg-brand-light ring-1 ring-inset ring-brand" : ""}`}
                      >
                        <td className="px-4 py-3 font-bold text-ink">#{row.rank}</td>
                        <td className="px-4 py-3 text-ink">{row.displayName}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold text-white ${LEVEL_COLOR[row.level]}`}>
                            {row.level}
                          </span>
                        </td>
                        <td className={`px-4 py-3 font-semibold text-ink ${isMe ? "animate-duo-pop" : ""}`}>
                          ⚡ {row.totalPoints.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-ink-muted">{row.verifiedContributions}</td>
                        <td className={`px-4 py-3 text-orange-400 ${isMe ? "animate-duo-pop" : ""}`}>🔥 {row.currentStreak}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {rows.length === 0 ? <p className="text-ink-muted">No contributors on the leaderboard yet.</p> : null}
        </>
      )}
    </div>
  );
}
