"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/lib/store";
import { api, type UserStatsResponse, type UserBadgesResponse, type ContributorDemographics } from "@/lib/api";
import { LEVEL_COLOR, LEVEL_THRESHOLDS, NEXT_LEVEL } from "@/lib/level";

export default function ProfilePage() {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);

  const [stats, setStats] = useState<UserStatsResponse["stats"]>(null);
  const [streak, setStreak] = useState(0);
  const [badges, setBadges] = useState<UserBadgesResponse["earned"]>([]);
  const [demographics, setDemographics] = useState<ContributorDemographics | null>(null);

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
    api.demographics.getMe().then(setDemographics).catch(() => setDemographics(null));
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
        <h1 className="text-2xl font-bold text-ink">{user.displayName}</h1>
        <span className={`mt-2 inline-block rounded-full px-4 py-1 text-sm font-extrabold text-white ${LEVEL_COLOR[level]}`}>
          {level}
        </span>
        {nextThreshold ? (
          <p className="mt-2 text-sm text-ink-muted">
            {verified} / {nextThreshold} verified contributions to reach {nextLevel}
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">Highest level reached</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total" value={stats?.totalContributions ?? user.totalContributions} />
        <StatCard label="Verified" value={verified} />
        <StatCard label="Points" value={stats?.totalPoints ?? user.totalPoints} />
        <StatCard label="Streak" value={streak} />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-bold text-ink">My Badges</h2>
        {badges.length === 0 ? (
          <p className="text-sm text-ink-muted">No badges earned yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
            {badges.map((badge) => (
              <div key={badge.id} className="flex flex-col items-center gap-2 rounded-2xl bg-surface p-4 shadow-sm text-center">
                <span className="text-3xl">{badge.icon}</span>
                <span className="text-xs font-medium text-ink">{badge.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {demographics && (
        <div>
          <h2 className="mb-3 text-lg font-bold text-ink">My Details</h2>
          <div className="grid grid-cols-2 gap-4 rounded-2xl bg-surface p-5 shadow-sm sm:grid-cols-3">
            <DetailField label="Full Name" value={demographics.fullName} />
            <DetailField label="Age" value={String(demographics.age)} />
            <DetailField label="Gender" value={GENDER_LABELS[demographics.gender]} />
            <DetailField label="Language" value={demographics.motherTongue} />
            <DetailField label="Tribe" value={demographics.tribeName} />
            <DetailField label="Sub-tribe" value={demographics.subTribeName} />
            <DetailField label="Country" value={demographics.country} />
            <DetailField label="City" value={demographics.city} />
            <DetailField label="Village" value={demographics.villageName} />
            <DetailField label="Quarter" value={demographics.quarterName} />
            <DetailField label="Dialect" value={demographics.dialect} />
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-lg font-bold text-ink">Edit Profile</h2>
        {isEditing ? (
          <div className="space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display name"
              className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
            />
            <textarea
              value={biography}
              onChange={(e) => setBiography(e.target.value)}
              placeholder="Biography"
              rows={4}
              className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
            />
            {saveError ? <p className="text-sm text-red-600">{saveError}</p> : null}
            <div className="flex gap-3">
              <button
                onClick={() => setIsEditing(false)}
                className="flex-1 rounded-full bg-surface-card py-2.5 font-semibold text-ink hover:bg-border"
              >
                Cancel
              </button>
              <button
                onClick={saveProfile}
                disabled={isSaving}
                className="flex-1 rounded-full bg-brand py-2.5 font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <button onClick={startEditing} className="rounded-full bg-surface-card px-5 py-2.5 font-semibold text-ink hover:bg-border">
            Edit Profile
          </button>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-surface p-5 shadow-sm text-center">
      <div className="text-2xl font-bold text-ink">{value}</div>
      <div className="mt-1 text-xs text-ink-muted">{label}</div>
    </div>
  );
}

const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
  prefer_not_to_say: "Prefer not to say",
};

function DetailField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div className="text-xs font-medium text-ink-muted">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-ink">{value ?? "—"}</div>
    </div>
  );
}
