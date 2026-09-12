"use client";

import { useEffect, useState } from "react";
import { api, getErrorMessage, type AdminUserDetail } from "@/lib/api";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border py-1.5 text-sm last:border-0">
      <span className="text-ink-muted">{label}</span>
      <span className="text-right font-medium text-ink">{value ?? "--"}</span>
    </div>
  );
}

function formatMs(ms: number | null): string {
  if (!ms) return "0m";
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** The full signup-form demographics plus a crude activity summary -- everything the admin users list itself doesn't have room to show. */
export function AdminUserDetailsModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.admin
      .getUserDetail(userId)
      .then(setDetail)
      .catch((err) => setError(getErrorMessage(err, "Failed to load user details")))
      .finally(() => setLoading(false));
  }, [userId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="card-duo max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">User Details</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink" aria-label="Close">
            ✕
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-ink-muted">Loading...</p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : detail ? (
          <div className="space-y-5">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Account</h3>
              <Row label="Name" value={detail.displayName} />
              <Row label="Email" value={detail.email} />
              <Row label="Role" value={detail.role} />
              <Row label="Joined" value={new Date(detail.createdAt).toLocaleDateString()} />
              <Row label="Last seen" value={detail.lastSeenAt ? new Date(detail.lastSeenAt).toLocaleString() : "Never"} />
              {detail.biography ? <Row label="Bio" value={detail.biography} /> : null}
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Signup Form</h3>
              {detail.fullName ? (
                <>
                  <Row label="Full name" value={detail.fullName} />
                  <Row label="Age" value={detail.age} />
                  <Row label="Date of birth" value={detail.dateOfBirth} />
                  <Row label="Gender" value={detail.gender} />
                  <Row label="Mother tongue" value={detail.motherTongue} />
                  <Row label="Tribe" value={detail.tribeName} />
                  <Row label="Sub-tribe" value={detail.subTribeName} />
                  <Row label="Country" value={detail.country} />
                  <Row label="City" value={detail.city} />
                  <Row label="Village" value={detail.villageName} />
                  <Row label="Quarter" value={detail.quarterName} />
                  <Row label="Dialect" value={detail.dialect} />
                  <Row label="Education" value={detail.educationLevel} />
                  <Row label="Profession" value={detail.profession} />
                </>
              ) : (
                <p className="text-sm text-ink-muted">This user hasn't completed the onboarding form yet.</p>
              )}
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Activity Summary</h3>
              <Row label="Level" value={detail.level} />
              <Row label="Total points" value={detail.totalPoints} />
              <Row label="Points this week / month" value={`${detail.pointsThisWeek ?? 0} / ${detail.pointsThisMonth ?? 0}`} />
              <Row
                label="Total contributions"
                value={`${detail.totalContributions ?? 0} (${detail.verifiedContributions ?? 0} verified, ${detail.pendingContributions ?? 0} pending, ${detail.rejectedContributions ?? 0} rejected)`}
              />
              <Row
                label="By module"
                value={`${detail.wordContributions ?? 0} word / ${detail.audioContributions ?? 0} audio / ${detail.translationContributions ?? 0} translation / ${detail.sceneContributionsCount ?? 0} scene`}
              />
              <Row
                label="Verified by module"
                value={`${detail.verifiedWords ?? 0} word / ${detail.verifiedAudios ?? 0} audio / ${detail.verifiedTranslations ?? 0} translation / ${detail.verifiedScenes ?? 0} scene`}
              />
              <Row label="Reviews completed" value={detail.reviewsCompleted} />
              <Row label="Total audio recorded" value={formatMs(detail.totalAudioDurationMs)} />
              <Row
                label="Last contribution"
                value={
                  detail.lastContributionAt
                    ? `${new Date(detail.lastContributionAt).toLocaleDateString()} (${detail.lastContributionModule})`
                    : "None yet"
                }
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
