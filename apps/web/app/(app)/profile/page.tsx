"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import {
  api,
  getErrorMessage,
  type EducationLevel,
  type UserStatsResponse,
  type UserBadgesResponse,
  type ContributorDemographics,
} from "@/lib/api";
import { LEVEL_COLOR, NEXT_LEVEL, useLevelThresholds } from "@/lib/level";
import { EDUCATION_LEVEL_OPTIONS } from "@/lib/demographics-constants";
import { ConfirmDialog } from "@/components/confirm-dialog";

export default function ProfilePage() {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const { logout } = useAuth();
  const router = useRouter();
  const levelThresholds = useLevelThresholds();

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

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [subTribeInput, setSubTribeInput] = useState("");
  const [quarterInput, setQuarterInput] = useState("");
  const [dialectInput, setDialectInput] = useState("");
  const [educationLevelInput, setEducationLevelInput] = useState<EducationLevel | "">("");
  const [professionInput, setProfessionInput] = useState("");
  const [isSavingOptional, setIsSavingOptional] = useState(false);
  const [optionalError, setOptionalError] = useState<string | null>(null);
  const [optionalSuccess, setOptionalSuccess] = useState<string | null>(null);

  async function saveOptionalFields() {
    setIsSavingOptional(true);
    setOptionalError(null);
    setOptionalSuccess(null);
    try {
      const updated = await api.demographics.fillOptional({
        subTribes: subTribeInput.trim()
          ? subTribeInput
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
        quarter: quarterInput.trim() || undefined,
        dialect: dialectInput.trim() || undefined,
        educationLevel: educationLevelInput || undefined,
        profession: professionInput.trim() || undefined,
      });
      setDemographics(updated);
      setSubTribeInput("");
      setQuarterInput("");
      setDialectInput("");
      setEducationLevelInput("");
      setProfessionInput("");
      setOptionalSuccess("Saved.");
    } catch (err) {
      setOptionalError(getErrorMessage(err, "Failed to save"));
    } finally {
      setIsSavingOptional(false);
    }
  }

  async function handleDeleteAccount() {
    setConfirmingDelete(false);
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await api.users.deleteAccount();
      await logout();
      router.push("/login");
    } catch (err) {
      setDeleteError(getErrorMessage(err, "Failed to delete account"));
      setIsDeleting(false);
    }
  }

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
  const totalContributions = stats?.totalContributions ?? user.totalContributions;
  const verified = stats?.verifiedContributions ?? user.verifiedContributions;
  const nextLevel = NEXT_LEVEL[level];
  const nextThreshold = nextLevel ? levelThresholds[nextLevel] : null;

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
              {totalContributions} / {nextThreshold} contributions to reach {nextLevel}
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
        <StatCard label="Points" value={stats?.totalPoints ?? user.totalPoints} emoji="⚡" />
        <StatCard label="Streak" value={streak} emoji="🔥" />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-bold text-ink">My Badges</h2>
        {badges.length === 0 ? (
          <p className="text-sm text-ink-muted">No badges earned yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
            {badges.map((badge) => (
              <div key={badge.id} className="card-duo flex flex-col items-center gap-2 rounded-2xl bg-surface p-4 shadow-sm text-center">
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
          <div className="card-duo grid grid-cols-2 gap-4 rounded-2xl bg-surface p-5 shadow-sm sm:grid-cols-3">
            <DetailField label="Full Name" value={demographics.fullName} />
            <DetailField
              label="Date of Birth"
              value={demographics.dateOfBirth ? new Date(demographics.dateOfBirth).toLocaleDateString() : null}
            />
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
            <DetailField
              label="Education Level"
              value={demographics.educationLevel ? EDUCATION_LEVEL_LABELS[demographics.educationLevel] : null}
            />
            <DetailField label="Profession" value={demographics.profession} />
          </div>

          {!demographics.subTribeName ||
          !demographics.quarterName ||
          !demographics.dialect ||
          !demographics.educationLevel ||
          !demographics.profession ? (
            <div className="card-duo mt-3 space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
              <p className="text-sm font-semibold text-ink">Complete your profile</p>
              <p className="text-xs text-ink-muted">
                Fill in whichever of these you skipped during sign-up. Once saved, each one is permanent and can&apos;t
                be changed here.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {!demographics.subTribeName ? (
                  <input
                    value={subTribeInput}
                    onChange={(e) => setSubTribeInput(e.target.value)}
                    placeholder="Sub-tribe (comma-separated for nested, e.g. Yousafzai, Akozai)"
                    autoComplete="off"
                    className="rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
                  />
                ) : null}
                {!demographics.quarterName ? (
                  <input
                    value={quarterInput}
                    onChange={(e) => setQuarterInput(e.target.value)}
                    placeholder="Quarter"
                    autoComplete="off"
                    className="rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
                  />
                ) : null}
                {!demographics.dialect ? (
                  <input
                    value={dialectInput}
                    onChange={(e) => setDialectInput(e.target.value)}
                    placeholder="Dialect"
                    autoComplete="off"
                    className="rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
                  />
                ) : null}
                {!demographics.educationLevel ? (
                  <select
                    value={educationLevelInput}
                    onChange={(e) => setEducationLevelInput(e.target.value as EducationLevel | "")}
                    className="rounded-lg bg-surface-card px-4 py-3 text-ink ring-1 ring-border"
                  >
                    <option value="">Select education level</option>
                    {EDUCATION_LEVEL_OPTIONS.map((e) => (
                      <option key={e.value} value={e.value}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                ) : null}
                {!demographics.profession ? (
                  <input
                    value={professionInput}
                    onChange={(e) => setProfessionInput(e.target.value)}
                    placeholder="Profession"
                    autoComplete="off"
                    className="rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
                  />
                ) : null}
              </div>
              {optionalError ? <p className="text-sm text-red-600">{optionalError}</p> : null}
              {optionalSuccess ? <p className="text-sm text-emerald-600">{optionalSuccess}</p> : null}
              <button
                onClick={saveOptionalFields}
                disabled={
                  isSavingOptional ||
                  (!subTribeInput.trim() && !quarterInput.trim() && !dialectInput.trim() && !educationLevelInput && !professionInput.trim())
                }
                className="btn-duo bg-brand px-5 py-2.5 font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
              >
                {isSavingOptional ? "Saving..." : "Save"}
              </button>
            </div>
          ) : null}
        </div>
      )}

      <div>
        <h2 className="mb-3 text-lg font-bold text-ink">Biography</h2>
        {isEditingBio ? (
          <div className="card-duo space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
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
                className="btn-duo btn-duo-secondary flex-1 bg-surface-card py-2.5 font-semibold text-ink hover:bg-border"
              >
                Cancel
              </button>
              <button
                onClick={saveBiography}
                disabled={isSavingBio}
                className="btn-duo flex-1 bg-brand py-2.5 font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
              >
                {isSavingBio ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <div className="card-duo space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
            <p className="text-sm text-ink">{user.biography || <span className="text-ink-muted">No biography yet.</span>}</p>
            <button onClick={startEditingBio} className="btn-duo btn-duo-secondary bg-surface-card px-5 py-2 text-sm font-semibold text-ink hover:bg-border">
              Edit Biography
            </button>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-bold text-ink">Change Password</h2>
        <div className="card-duo space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
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
            className="btn-duo bg-brand px-5 py-2.5 font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
          >
            {isChangingPassword ? "Changing..." : "Change Password"}
          </button>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-bold text-red-600">Danger Zone</h2>
        <div className="card-duo space-y-3 rounded-2xl bg-surface p-5 shadow-sm ring-1 ring-red-200">
          <p className="text-sm text-ink-muted">
            Once you delete your account, you will lose access to all of your data and will not be able to login to
            this account and sign up again with the same email.
          </p>
          {deleteError ? <p className="text-sm text-red-600">{deleteError}</p> : null}
          <button
            onClick={() => setConfirmingDelete(true)}
            disabled={isDeleting}
            className="btn-duo bg-red-600 px-5 py-2.5 font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            {isDeleting ? "Deleting..." : "Delete Account"}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete your account?"
        message="Once you delete your account, you will lose access to all of your data and will not be able to login to this account and sign up again with the same email."
        confirmLabel="Delete Account"
        danger
        onConfirm={handleDeleteAccount}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  );
}

function StatCard({ label, value, emoji }: { label: string; value: number; emoji?: string }) {
  return (
    <div className="card-duo rounded-2xl bg-surface p-5 shadow-sm text-center">
      <div className="animate-duo-pop text-2xl font-bold text-ink">
        {emoji ? `${emoji} ` : ""}
        {value}
      </div>
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

const EDUCATION_LEVEL_LABELS: Record<string, string> = {
  none: "None",
  high_school: "High School",
  bachelors: "Bachelors",
  masters: "Masters",
  phd: "PhD",
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
