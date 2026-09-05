"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useAuthStore } from "@/lib/store";
import { api, getErrorMessage, type UserStatsResponse, type UserBadgesResponse, type ContributorDemographics } from "@/lib/api";
import { LEVEL_COLOR, LEVEL_THRESHOLDS, NEXT_LEVEL } from "@/lib/level";

export default function ProfilePage() {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);

  const [stats, setStats] = useState<UserStatsResponse["stats"]>(null);
  const [streak, setStreak] = useState(0);
  const [badges, setBadges] = useState<UserBadgesResponse["earned"]>([]);
  const [demographics, setDemographics] = useState<ContributorDemographics | null>(null);

  const [isEditingBio, setIsEditingBio] = useState(false);
  const [biography, setBiography] = useState(user?.biography ?? "");
  const [isSavingBio, setIsSavingBio] = useState(false);
  const [bioError, setBioError] = useState<string | null>(null);

  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarVersion, setAvatarVersion] = useState(0);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

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

  function startEditingBio() {
    setBiography(user!.biography ?? "");
    setBioError(null);
    setIsEditingBio(true);
  }

  async function saveBiography() {
    setIsSavingBio(true);
    setBioError(null);
    try {
      const updated = await api.users.updateMe({ biography: biography.trim() || undefined });
      setUser(updated);
      setIsEditingBio(false);
    } catch (err) {
      setBioError(getErrorMessage(err, "Failed to save biography"));
    } finally {
      setIsSavingBio(false);
    }
  }

  async function handleAvatarChange(file: File | undefined) {
    if (!file) return;
    setIsUploadingAvatar(true);
    setAvatarError(null);
    try {
      const updated = await api.users.uploadAvatar(file);
      setUser(updated);
      setAvatarVersion((v) => v + 1); // bust cache -- same URL, new content
    } catch (err) {
      setAvatarError(getErrorMessage(err, "Failed to upload profile picture"));
    } finally {
      setIsUploadingAvatar(false);
    }
  }

  async function handleChangePassword() {
    setPasswordError(null);
    setPasswordSuccess(null);
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }
    setIsChangingPassword(true);
    try {
      await api.auth.changePassword(currentPassword, newPassword);
      setPasswordSuccess("Password changed.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPasswordError(getErrorMessage(err, "Failed to change password"));
    } finally {
      setIsChangingPassword(false);
    }
  }

  const avatarSrc = user.avatarUrl ? `${user.avatarUrl}${avatarVersion ? `?v=${avatarVersion}` : ""}` : null;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex items-center gap-5">
        <div className="relative">
          {avatarSrc ? (
            <Image
              src={avatarSrc}
              alt={user.displayName}
              width={80}
              height={80}
              className="h-20 w-20 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-card text-2xl font-bold text-ink-muted">
              {user.displayName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <label className="absolute -bottom-1 -right-1 cursor-pointer rounded-full bg-brand p-1.5 text-ink-inverted shadow-sm hover:bg-brand-dark">
            <CameraIcon />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={isUploadingAvatar}
              onChange={(e) => {
                handleAvatarChange(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
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
      </div>
      {isUploadingAvatar ? <p className="text-sm text-ink-muted">Uploading...</p> : null}
      {avatarError ? <p className="text-sm text-red-600">{avatarError}</p> : null}

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
          <p className="mb-3 text-xs text-ink-muted">These were set during sign-up and can&apos;t be changed here.</p>
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
        <h2 className="mb-3 text-lg font-bold text-ink">Biography</h2>
        {isEditingBio ? (
          <div className="space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
            <textarea
              value={biography}
              onChange={(e) => setBiography(e.target.value)}
              placeholder="Tell people a bit about yourself"
              rows={4}
              className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
            />
            {bioError ? <p className="text-sm text-red-600">{bioError}</p> : null}
            <div className="flex gap-3">
              <button
                onClick={() => setIsEditingBio(false)}
                className="flex-1 rounded-full bg-surface-card py-2.5 font-semibold text-ink hover:bg-border"
              >
                Cancel
              </button>
              <button
                onClick={saveBiography}
                disabled={isSavingBio}
                className="flex-1 rounded-full bg-brand py-2.5 font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
              >
                {isSavingBio ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
            <p className="text-sm text-ink">{user.biography || <span className="text-ink-muted">No biography yet.</span>}</p>
            <button onClick={startEditingBio} className="rounded-full bg-surface-card px-5 py-2 text-sm font-semibold text-ink hover:bg-border">
              Edit Biography
            </button>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-bold text-ink">Change Password</h2>
        <div className="space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            autoComplete="new-password"
            className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
            className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
          />
          {passwordError ? <p className="text-sm text-red-600">{passwordError}</p> : null}
          {passwordSuccess ? <p className="text-sm text-emerald-600">{passwordSuccess}</p> : null}
          <button
            onClick={handleChangePassword}
            disabled={isChangingPassword || !currentPassword || !newPassword || !confirmPassword}
            className="rounded-full bg-brand px-5 py-2.5 font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
          >
            {isChangingPassword ? "Changing..." : "Change Password"}
          </button>
        </div>
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

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
