"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/lib/store";
import { api, type LeaderboardRow } from "@/lib/api";
import { LEVEL_COLOR } from "@/lib/level";

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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Leaderboard</h1>

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-surface shadow-sm">
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
              {rows.map((row) => {
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
                    <td className="px-4 py-3 font-semibold text-ink">{row.totalPoints.toLocaleString()}</td>
                    <td className="px-4 py-3 text-ink-muted">{row.verifiedContributions}</td>
                    <td className="px-4 py-3 text-orange-400">🔥 {row.currentStreak}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
