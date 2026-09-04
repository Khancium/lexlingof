"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/lib/store";
import { api, type ContributionListItem, type ModuleType, type UserStatsResponse } from "@/lib/api";
import { LEVEL_COLOR, LEVEL_THRESHOLDS, NEXT_LEVEL } from "@/lib/level";

const MODULE_ICON: Record<ModuleType, string> = {
  WORD: "🎙️",
  TRANSCRIPTION: "📤",
  TRANSLATION: "🌐",
  SCENE: "🖼️",
};

const STATUS_COLOR: Record<string, string> = {
  draft: "bg-slate-600",
  pending: "bg-yellow-600",
  under_review: "bg-yellow-600",
  verified: "bg-emerald-600",
  needs_correction: "bg-red-600",
  rejected: "bg-red-600",
};

const QUICK_ACTIONS = [
  { href: "/contribute/concept", title: "Record a Word", color: "border-blue-500" },
  { href: "/contribute/audio", title: "Upload Audio", color: "border-purple-500" },
  { href: "/contribute/translate", title: "Translate", color: "border-emerald-500" },
  { href: "/contribute/scene", title: "Describe a Scene", color: "border-amber-500" },
];

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const [stats, setStats] = useState<UserStatsResponse["stats"]>(null);
  const [streak, setStreak] = useState(0);
  const [recent, setRecent] = useState<ContributionListItem[]>([]);

  useEffect(() => {
    api.users.getStats().then((res) => {
      setStats(res.stats);
      setStreak(res.streak?.currentStreak ?? 0);
    });
    api.users.getContributions({ limit: 5 }).then((res) => setRecent(res.items));
  }, []);

  const level = stats?.level ?? user?.level ?? "BRONZE";
  const verified = stats?.verifiedContributions ?? user?.verifiedContributions ?? 0;
  const nextLevel = NEXT_LEVEL[level];
  const nextThreshold = nextLevel ? LEVEL_THRESHOLDS[nextLevel] : null;
  const progressPct = nextThreshold ? Math.min(100, Math.round((verified / nextThreshold) * 100)) : 100;

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold text-white">Welcome back, {user?.displayName}</h1>

      <div className={`rounded-xl p-6 text-white ${LEVEL_COLOR[level]}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-extrabold">{level}</div>
            <div className="text-sm opacity-90">{verified} verified contributions</div>
          </div>
          {nextThreshold ? (
            <div className="text-right text-sm font-semibold opacity-90">
              {verified} / {nextThreshold} for {nextLevel}
            </div>
          ) : (
            <div className="text-sm font-semibold opacity-90">Highest level reached</div>
          )}
        </div>
        {nextThreshold ? (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/20">
            <div className="h-full bg-white" style={{ width: `${progressPct}%` }} />
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Contributions" value={stats?.totalContributions ?? 0} />
        <StatCard label="Verified" value={verified} />
        <StatCard label="Points" value={stats?.totalPoints ?? user?.totalPoints ?? 0} />
        <StatCard label="Streak" value={streak} />
      </div>

      <div>
        <h2 className="mb-4 text-xl font-bold text-white">Contribute</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className={`rounded-xl border-l-4 bg-slate-800 p-6 font-semibold text-white transition hover:bg-slate-700 ${action.color}`}
            >
              {action.title}
            </Link>
          ))}
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-xl font-bold text-white">Recent Contributions</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-slate-400">No contributions yet -- get started above.</p>
        ) : (
          <div className="space-y-2">
            {recent.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg bg-slate-800 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span>{MODULE_ICON[item.moduleType]}</span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-semibold capitalize text-white ${STATUS_COLOR[item.status] ?? "bg-slate-600"}`}
                  >
                    {item.status.replace("_", " ")}
                  </span>
                  <span className="text-sm text-slate-400">{new Date(item.submittedAt).toLocaleDateString()}</span>
                </div>
                <span className="font-semibold text-emerald-400">+{item.totalPoints ?? 0}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-slate-800 p-5 text-center">
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-400">{label}</div>
    </div>
  );
}
