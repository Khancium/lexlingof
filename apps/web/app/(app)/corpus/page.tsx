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
    return <p className="text-slate-400">Loading...</p>;
  }

  const maxLanguageCount = Math.max(1, ...languages.map((l) => l.contributionCount));

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-3xl font-bold text-white">Corpus Analytics</h1>
        <p className="mt-1 text-slate-400">What our contributors have collected so far.</p>
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
        <h2 className="mb-4 text-xl font-bold text-white">By Module</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(MODULE_INFO) as ModuleType[]).map((moduleType) => {
            const info = MODULE_INFO[moduleType];
            return (
              <div key={moduleType} className={`rounded-xl border-l-4 bg-slate-800 p-5 ${info.color}`}>
                <div className="text-2xl">{info.icon}</div>
                <div className="mt-2 text-2xl font-bold text-white">{stats.countByModuleType[moduleType] ?? 0}</div>
                <div className="text-sm text-slate-400">{info.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Category coverage */}
      <div>
        <h2 className="mb-4 text-xl font-bold text-white">Category Coverage</h2>
        <div className="overflow-x-auto rounded-xl bg-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-700 text-slate-400">
              <tr>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Concepts</th>
                <th className="px-4 py-3">Recorded (Module 1)</th>
                <th className="px-4 py-3">Word Recording Coverage</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id} className="border-b border-slate-700/50 last:border-0">
                  <td className="px-4 py-3 font-medium text-white">{category.name}</td>
                  <td className="px-4 py-3 text-slate-300">{category.totalConcepts}</td>
                  <td className="px-4 py-3 text-slate-300">{category.conceptsWithRecordings}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-700">
                        <div className="h-full bg-blue-500" style={{ width: `${category.wordRecordingCoveragePct}%` }} />
                      </div>
                      <span className="font-semibold text-white">
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
        <h2 className="mb-4 text-xl font-bold text-white">Contributions by Language</h2>
        <div className="space-y-3 rounded-xl bg-slate-800 p-5">
          {languages.map((language) => (
            <div key={language.id} className="flex items-center gap-4">
              <span className="w-32 shrink-0 text-sm font-medium text-white">{language.nameEnglish}</span>
              <div className="h-4 flex-1 overflow-hidden rounded-full bg-slate-700">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${(language.contributionCount / maxLanguageCount) * 100}%` }}
                />
              </div>
              <span className="w-12 shrink-0 text-right text-sm text-slate-400">{language.contributionCount}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Coverage clarification note */}
      <div className="rounded-lg border border-slate-700 bg-slate-900 p-5 text-sm text-slate-400">
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
    <div className="rounded-xl bg-slate-800 p-6 text-center">
      <div className="text-3xl font-extrabold text-blue-500">{value.toLocaleString()}</div>
      <div className="mt-1 text-sm text-slate-400">{label}</div>
    </div>
  );
}
