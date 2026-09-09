"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/lib/store";
import { api, type UserStatsResponse } from "@/lib/api";
import { LEVEL_COLOR, NEXT_LEVEL, useLevelThresholds } from "@/lib/level";

const QUICK_ACTIONS = [
  { href: "/contribute/concept", title: "Record a Word", color: "border-brand" },
  { href: "/contribute/audio", title: "Upload Audio", color: "border-accent" },
  { href: "/contribute/translate", title: "Translate", color: "border-emerald-500" },
  { href: "/contribute/scene", title: "Describe a Scene", color: "border-amber-500" },
];

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const [stats, setStats] = useState<UserStatsResponse["stats"]>(null);
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    api.users.getStats().then((res) => {
      setStats(res.stats);
      setStreak(res.streak?.currentStreak ?? 0);
    });
  }, []);

  const levelThresholds = useLevelThresholds();
  const level = stats?.level ?? user?.level ?? "BRONZE";
  const totalContributions = stats?.totalContributions ?? user?.totalContributions ?? 0;
  const nextLevel = NEXT_LEVEL[level];
  const nextThreshold = nextLevel ? levelThresholds[nextLevel] : null;
  const progressPct = nextThreshold ? Math.min(100, Math.round((totalContributions / nextThreshold) * 100)) : 100;

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold text-ink">Welcome back, {user?.displayName}</h1>

      <div className={`card-duo rounded-2xl p-6 text-white shadow-sm ${LEVEL_COLOR[level]}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-extrabold">{level}</div>
            <div className="text-sm opacity-90">{totalContributions} contributions</div>
          </div>
          {nextThreshold ? (
            <div className="text-right text-sm font-semibold opacity-90">
              {totalContributions} / {nextThreshold} for {nextLevel}
            </div>
          ) : (
            <div className="text-sm font-semibold opacity-90">Highest level reached</div>
          )}
        </div>
        {nextThreshold ? (
          <div className="progress-duo-track mt-4 bg-black/20">
            <div className="progress-duo-fill bg-white" style={{ width: `${progressPct}%` }} />
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Contributions" value={stats?.totalContributions ?? 0} />
        <StatCard label="Points" value={stats?.totalPoints ?? user?.totalPoints ?? 0} emoji="⚡" />
        <StatCard label="Streak" value={streak} emoji="🔥" />
      </div>

      <div>
        <h2 className="mb-4 text-xl font-bold text-ink">Contribute</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className={`card-duo rounded-2xl border-l-4 bg-surface p-6 font-semibold text-ink shadow-sm transition hover:bg-surface-card ${action.color}`}
            >
              {action.title}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, emoji }: { label: string; value: number; emoji?: string }) {
  return (
    <div className="card-duo rounded-2xl bg-surface-card p-5 text-center shadow-sm">
      <div className="animate-duo-pop text-2xl font-bold text-ink">
        {emoji ? `${emoji} ` : ""}
        {value}
      </div>
      <div className="mt-1 text-xs text-ink-muted">{label}</div>
    </div>
  );
}
