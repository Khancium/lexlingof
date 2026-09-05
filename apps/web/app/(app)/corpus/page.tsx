"use client";

import { useEffect, useState } from "react";
import { api, type CorpusCategoryCoverage, type CorpusLanguageBreakdown, type CorpusStats, type ModuleType } from "@/lib/api";

const MODULE_INFO: Record<ModuleType, { label: string; icon: string; color: string }> = {
  WORD: { label: "Words Recorded", icon: "🎙️", color: "border-blue-500" },
  TRANSCRIPTION: { label: "Audio Uploaded", icon: "📤", color: "border-purple-500" },
  TRANSLATION: { label: "Sentences Translated", icon: "🌐", color: "border-emerald-500" },
  SCENE: { label: "Scenes Described", icon: "🖼️", color: "border-amber-500" },
};

export default function CorpusPage() {
  const [stats, setStats] = useState<CorpusStats | null>(null);
  const [categories, setCategories] = useState<CorpusCategoryCoverage[]>([]);
  const [languages, setLanguages] = useState<CorpusLanguageBreakdown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.corpus.getStats(), api.corpus.getCategories(), api.corpus.getLanguages()]).then(
      ([s, c, l]) => {
        setStats(s);
        setCategories(c);
        setLanguages(l);
        setLoading(false);
      },
    );
  }, []);

  if (loading || !stats) {
    return <p className="text-ink-muted">Loading...</p>;
  }

  const maxLanguageCount = Math.max(1, ...languages.map((l) => l.contributionCount));

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-bold text-ink">Corpus Analytics</h1>
        <p className="mt-1 text-ink-muted">What our contributors have collected so far.</p>
      </div>

      {/* Hero stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <HeroStat value={stats.audioHours} label="Audio Hours" />
        <HeroStat value={stats.totalActiveContributors} label="Contributors" />
        <HeroStat value={stats.verifiedContributions} label="Verified Contributions" />
        <HeroStat value={stats.activeLanguages} label="Languages Covered" />
      </div>

      {/* Module breakdown */}
      <div>
        <h2 className="mb-4 text-xl font-bold text-ink">By Module</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(MODULE_INFO) as ModuleType[]).map((moduleType) => {
            const info = MODULE_INFO[moduleType];
            return (
              <div key={moduleType} className={`rounded-2xl border-l-4 bg-surface p-5 shadow-sm ${info.color}`}>
                <div className="text-2xl">{info.icon}</div>
                <div className="mt-2 text-2xl font-bold text-ink">{stats.countByModuleType[moduleType] ?? 0}</div>
                <div className="text-sm text-ink-muted">{info.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Category coverage */}
      <div>
        <h2 className="mb-4 text-xl font-bold text-ink">Category Coverage</h2>
        <div className="overflow-x-auto rounded-2xl bg-surface shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-ink-muted">
              <tr>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Concepts</th>
                <th className="px-4 py-3">Recorded (Module 1)</th>
                <th className="px-4 py-3">Word Recording Coverage</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{category.name}</td>
                  <td className="px-4 py-3 text-ink-muted">{category.totalConcepts}</td>
                  <td className="px-4 py-3 text-ink-muted">{category.conceptsWithRecordings}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-surface-card">
                        <div className="h-full bg-brand" style={{ width: `${category.wordRecordingCoveragePct}%` }} />
                      </div>
                      <span className="font-semibold text-ink">
                        Word Recording Coverage: {category.wordRecordingCoveragePct}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Language breakdown */}
      <div>
        <h2 className="mb-4 text-xl font-bold text-ink">Contributions by Language</h2>
        <div className="space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
          {languages.map((language) => (
            <div key={language.id} className="flex items-center gap-4">
              <span className="w-32 shrink-0 text-sm font-medium text-ink">{language.nameEnglish}</span>
              <div className="h-4 flex-1 overflow-hidden rounded-full bg-surface-card">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${(language.contributionCount / maxLanguageCount) * 100}%` }}
                />
              </div>
              <span className="w-12 shrink-0 text-right text-sm text-ink-muted">{language.contributionCount}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Coverage clarification note */}
      <div className="rounded-xl border border-border bg-surface-card p-5 text-sm text-ink-muted">
        <p>
          Coverage shown reflects verified word recordings. Scene images may contain additional objects that have not
          necessarily been recorded as spoken words. These are tracked separately by our annotation team.
        </p>
      </div>
    </div>
  );
}

function HeroStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl bg-surface p-6 shadow-sm text-center">
      <div className="text-3xl font-extrabold text-brand">{value.toLocaleString()}</div>
      <div className="mt-1 text-sm text-ink-muted">{label}</div>
    </div>
  );
}
