import Link from "next/link";
import { api, type CorpusStats } from "@/lib/api";

export const dynamic = "force-dynamic";

const MODULES = [
  {
    title: "Record Words",
    color: "border-brand",
    description: "Record individual words in your language, 3 seconds at a time.",
  },
  {
    title: "Upload Audio",
    color: "border-accent",
    description: "Share existing recordings of conversations and stories.",
  },
  {
    title: "Translate Sentences",
    color: "border-emerald-500",
    description: "Translate and record English sentences in your language.",
  },
  {
    title: "Describe Scenes",
    color: "border-amber-500",
    description: "Describe what you see in an image, in your own words.",
  },
];

async function getStats(): Promise<CorpusStats | null> {
  try {
    return await api.corpus.getStats();
  } catch {
    return null;
  }
}

export default async function LandingPage() {
  const stats = await getStats();

  return (
    <div className="min-h-screen bg-surface-muted text-ink">
      <header className="border-b border-border bg-surface px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <span className="text-xl font-bold text-brand">Lexlingo</span>
          <div className="flex gap-3">
            <Link href="/login" className="rounded-full px-4 py-2 text-sm font-medium text-ink-muted hover:text-ink">
              Log In
            </Link>
            <Link href="/register" className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark">
              Register
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-24 text-center bg-gradient-to-b from-accent-light to-surface-muted">
        <h1 className="text-4xl font-extrabold tracking-tight text-ink sm:text-6xl">Document Languages Together</h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-ink-muted">
          Lexlingo is a community platform for recording, translating, and preserving under-documented languages --
          one word, sentence, and story at a time.
        </p>
        <Link
          href="/register"
          className="mt-10 inline-block rounded-full bg-brand px-8 py-4 text-lg font-semibold text-ink-inverted shadow-sm transition hover:bg-brand-dark"
        >
          Start Contributing
        </Link>
      </section>

      <section className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-4">
        {MODULES.map((m) => (
          <div key={m.title} className={`rounded-2xl border-l-4 bg-surface p-6 shadow-sm ${m.color}`}>
            <h3 className="text-lg font-bold text-ink">{m.title}</h3>
            <p className="mt-2 text-sm text-ink-muted">{m.description}</p>
          </div>
        ))}
      </section>

      {stats ? (
        <section className="border-t border-border bg-surface-card px-6 py-16">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 text-center sm:grid-cols-4">
            <Stat value={stats.totalActiveContributors} label="Active Contributors" />
            <Stat value={stats.totalContributions} label="Contributions" />
            <Stat value={stats.activeLanguages} label="Languages" />
            <Stat value={stats.audioHours} label="Hours of Audio" />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-4xl font-extrabold text-brand">{value.toLocaleString()}</div>
      <div className="mt-1 text-sm text-ink-muted">{label}</div>
    </div>
  );
}
