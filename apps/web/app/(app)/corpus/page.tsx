"use client";

import { useEffect, useState } from "react";
import { api, type CorpusLanguageBreakdown, type CorpusStats } from "@/lib/api";

export default function CorpusPage() {
  const [stats, setStats] = useState<CorpusStats | null>(null);
  const [languages, setLanguages] = useState<CorpusLanguageBreakdown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.corpus.getStats(), api.corpus.getLanguages()]).then(([s, l]) => {
      setStats(s);
      setLanguages(l);
      setLoading(false);
    });
  }, []);

  if (loading || !stats) {
    return <p className="text-ink-muted">Loading...</p>;
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-bold text-ink">Corpus Analytics</h1>
        <p className="mt-1 text-ink-muted">What our contributors have collected so far.</p>
      </div>

      {/* Hero stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <HeroStat value={stats.audioHours} label="Audio Hours" />
        <HeroStat value={stats.totalActiveContributors} label="Contributors" />
        <HeroStat value={stats.activeLanguages} label="Languages Covered" />
      </div>

      {/* Language breakdown */}
      <div>
        <h2 className="mb-4 text-xl font-bold text-ink">Contributions by Language</h2>
        <LanguageBarChart languages={languages} />
      </div>
    </div>
  );
}

function HeroStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="card-duo rounded-2xl bg-surface p-6 shadow-sm text-center">
      <div className="text-3xl font-extrabold text-brand">{value.toLocaleString()}</div>
      <div className="mt-1 text-sm text-ink-muted">{label}</div>
    </div>
  );
}

function LanguageBarChart({ languages }: { languages: CorpusLanguageBreakdown[] }) {
  if (languages.length === 0) {
    return (
      <div className="card-duo rounded-2xl bg-surface p-6 text-center text-sm text-ink-muted shadow-sm">
        No language data yet.
      </div>
    );
  }

  const max = Math.max(1, ...languages.map((l) => l.contributionCount));

  return (
    <div className="card-duo overflow-x-auto rounded-2xl bg-surface p-6 shadow-sm">
      <div className="flex h-56 min-w-max items-end justify-around gap-4 border-b border-border pb-2">
        {languages.map((lang) => {
          const pct = lang.contributionCount === 0 ? 0 : Math.max(4, Math.round((lang.contributionCount / max) * 100));
          return (
            <div key={lang.id} className="flex h-full w-16 flex-shrink-0 flex-col items-center justify-end gap-2">
              <span className="text-sm font-bold text-ink">{lang.contributionCount}</span>
              <div
                className="w-full max-w-16 rounded-t-lg bg-brand transition-all"
                style={{ height: `${pct}%` }}
                role="img"
                aria-label={`${lang.nameEnglish}: ${lang.contributionCount} contributions`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex min-w-max justify-around gap-4">
        {languages.map((lang) => (
          <span key={lang.id} className="w-16 flex-shrink-0 text-center text-sm font-medium text-ink-muted">
            {lang.nameEnglish}
          </span>
        ))}
      </div>
    </div>
  );
}
