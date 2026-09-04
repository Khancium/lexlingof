import Link from "next/link";
import { api, type CorpusStats } from "@/lib/api";

export const dynamic = "force-dynamic";

const MODULES = [
  {
    title: "Record Words",
    color: "border-blue-500",
    description: "Record individual words in your language, 3 seconds at a time.",
  },
  {
    title: "Upload Audio",
    color: "border-purple-500",
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
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="border-b border-slate-800 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <span className="text-xl font-bold text-blue-500">Lexlingo</span>
          <div className="flex gap-3">
            <Link href="/login" className="rounded-md px-4 py-2 text-sm font-medium text-slate-300 hover:text-white">
              Log In
            </Link>
            <Link href="/register" className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500">
              Register
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl">Document Languages Together</h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          Lexlingo is a community platform for recording, translating, and preserving under-documented languages --
          one word, sentence, and story at a time.
        </p>
        <Link
          href="/register"
          className="mt-10 inline-block rounded-lg bg-blue-600 px-8 py-4 text-lg font-semibold text-white shadow-lg transition hover:bg-blue-500"
        >
          Start Contributing
        </Link>
      </section>

      <section className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-4">
        {MODULES.map((m) => (
          <div key={m.title} className={`rounded-xl border-l-4 bg-slate-800 p-6 ${m.color}`}>
            <h3 className="text-lg font-bold">{m.title}</h3>
            <p className="mt-2 text-sm text-slate-400">{m.description}</p>
          </div>
        ))}
      </section>

      {stats ? (
        <section className="border-t border-slate-800 bg-slate-950 px-6 py-16">
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
      <div className="text-4xl font-extrabold text-blue-500">{value.toLocaleString()}</div>
      <div className="mt-1 text-sm text-slate-400">{label}</div>
    </div>
  );
}
