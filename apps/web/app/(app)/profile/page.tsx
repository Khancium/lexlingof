"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/lib/store";
import { api, type UserStatsResponse, type UserBadgesResponse } from "@/lib/api";
import { LEVEL_COLOR, LEVEL_THRESHOLDS, NEXT_LEVEL } from "@/lib/level";

export default function ProfilePage() {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);

  const [stats, setStats] = useState<UserStatsResponse["stats"]>(null);
  const [streak, setStreak] = useState(0);
  const [badges, setBadges] = useState<UserBadgesResponse["earned"]>([]);

  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [biography, setBiography] = useState(user?.biography ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api.users.getStats().then((res) => {
      setStats(res.stats);
      setStreak(res.streak?.currentStreak ?? 0);
    });
    api.badges.getForUser(user.id).then((res) => setBadges(res.earned));
  }, [user]);

  if (!user) return null;

  const level = stats?.level ?? user.level;
  const verified = stats?.verifiedContributions ?? user.verifiedContributions;
  const nextLevel = NEXT_LEVEL[level];
  const nextThreshold = nextLevel ? LEVEL_THRESHOLDS[nextLevel] : null;

  function startEditing() {
    setDisplayName(user!.displayName);
    setBiography(user!.biography ?? "");
    setSaveError(null);
    setIsEditing(true);
  }

  async function saveProfile() {
    setIsSaving(true);
    setSaveError(null);
    try {
      const updated = await api.users.updateMe({ displayName: displayName.trim(), biography: biography.trim() || undefined });
      setUser(updated);
      setIsEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">{user.displayName}</h1>
        <span className={`mt-2 inline-block rounded-full px-4 py-1 text-sm font-extrabold text-white ${LEVEL_COLOR[level]}`}>
          {level}
        </span>
        {nextThreshold ? (
          <p className="mt-2 text-sm text-slate-400">
            {verified} / {nextThreshold} verified contributions to reach {nextLevel}
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-400">Highest level reached</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total" value={stats?.totalContributions ?? user.totalContributions} />
        <StatCard label="Verified" value={verified} />
        <StatCard label="Points" value={stats?.totalPoints ?? user.totalPoints} />
        <StatCard label="Streak" value={streak} />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-bold text-white">My Badges</h2>
        {badges.length === 0 ? (
          <p className="text-sm text-slate-400">No badges earned yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
            {badges.map((badge) => (
              <div key={badge.id} className="flex flex-col items-center gap-2 rounded-xl bg-slate-800 p-4 text-center">
                <span className="text-3xl">{badge.icon}</span>
                <span className="text-xs font-medium text-white">{badge.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-bold text-white">Edit Profile</h2>
        {isEditing ? (
          <div className="space-y-3 rounded-xl bg-slate-800 p-5">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display name"
              className="w-full rounded-lg bg-slate-900 px-4 py-3 text-white placeholder-slate-500 ring-1 ring-slate-700 focus:ring-2 focus:ring-blue-500"
            />
            <textarea
              value={biography}
              onChange={(e) => setBiography(e.target.value)}
              placeholder="Biography"
              rows={4}
              className="w-full rounded-lg bg-slate-900 px-4 py-3 text-white placeholder-slate-500 ring-1 ring-slate-700 focus:ring-2 focus:ring-blue-500"
            />
            {saveError ? <p className="text-sm text-red-400">{saveError}</p> : null}
            <div className="flex gap-3">
              <button
                onClick={() => setIsEditing(false)}
                className="flex-1 rounded-lg bg-slate-700 py-2.5 font-semibold text-white hover:bg-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={saveProfile}
                disabled={isSaving}
                className="flex-1 rounded-lg bg-blue-600 py-2.5 font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={startEditing} className="rounded-lg bg-slate-800 px-5 py-2.5 font-semibold text-white hover:bg-slate-700">
            Edit Profile
          </button>
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
