"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type AdminAnalytics, type AdminContributionListItem, type ModuleType } from "@/lib/api";

const MODULE_LABEL: Record<ModuleType, string> = {
  WORD: "Word",
  TRANSCRIPTION: "Audio Upload",
  TRANSLATION: "Translation",
  SCENE: "Scene",
};

const QUICK_LINKS = [
  { href: "/admin/contributions", label: "Review Contributions" },
  { href: "/admin/concepts", label: "Manage Concepts" },
  { href: "/admin/scenes", label: "Manage Scenes" },
  { href: "/admin/sentences", label: "Manage Sentences" },
];

export default function AdminDashboardPage() {
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [recent, setRecent] = useState<AdminContributionListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.admin.getAnalytics(), api.admin.getContributions({ limit: 5 })]).then(([a, c]) => {
      setAnalytics(a);
      setRecent(c);
      setLoading(false);
    });
  }, []);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-ink">Admin Dashboard</h1>

      {loading ? (
        <p className="text-ink-muted">Loading...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Card label="Total Users" value={analytics?.totalUsers ?? 0} />
            <Card label="Contributions Today" value={analytics?.contributionsToday ?? 0} />
            <Card label="Pending Reviews" value={analytics?.reviewQueueDepth ?? 0} />
            <Card label="Verified Today" value={analytics?.verifiedToday ?? 0} />
          </div>

          <div>
            <h2 className="mb-3 text-lg font-bold text-ink">Quick Links</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {QUICK_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-2xl bg-surface-card p-4 text-center text-sm font-semibold text-ink hover:bg-border shadow-sm"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-lg font-bold text-ink">Recent Contributions</h2>
            <div className="overflow-x-auto rounded-2xl bg-surface shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-ink-muted">
                  <tr>
                    <th className="px-4 py-3">Contributor</th>
                    <th className="px-4 py-3">Module</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((item) => (
                    <tr key={item.contributionId} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 text-ink">{item.contributor.displayName}</td>
                      <td className="px-4 py-3 text-ink-muted">{MODULE_LABEL[item.moduleType]}</td>
                      <td className="px-4 py-3 capitalize text-ink-muted">{item.status.replace("_", " ")}</td>
                      <td className="px-4 py-3 text-ink-muted">{new Date(item.submittedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-surface p-5 shadow-sm text-center">
      <div className="text-3xl font-bold text-ink">{value}</div>
      <div className="mt-1 text-xs text-ink-muted">{label}</div>
    </div>
  );
}
