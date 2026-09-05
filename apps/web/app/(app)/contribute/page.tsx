import Link from "next/link";

const CARDS: { href: string; color: string; icon: string; title: string; description: string }[] = [
  {
    href: "/contribute/concept",
    color: "border-l-brand",
    icon: "🎙️",
    title: "Record Words",
    description: "Record individual words in your language",
  },
  {
    href: "/contribute/audio",
    color: "border-l-accent",
    icon: "☁️",
    title: "Upload Audio",
    description: "Share existing recordings of conversations and stories",
  },
  {
    href: "/contribute/translate",
    color: "border-l-emerald-600",
    icon: "🌐",
    title: "Translate Sentences",
    description: "Translate and record English sentences",
  },
  {
    href: "/contribute/scene",
    color: "border-l-amber-600",
    icon: "🖼️",
    title: "Describe a Scene",
    description: "Describe what you see in an image",
  },
];

export default function ContributePage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-ink">Contribute</h1>

      <div className="space-y-4">
        {CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className={`flex items-center gap-4 rounded-2xl border-l-4 bg-surface p-5 shadow-sm transition hover:shadow-md ${card.color}`}
          >
            <span className="text-3xl">{card.icon}</span>
            <div className="flex-1">
              <div className="font-bold text-ink">{card.title}</div>
              <div className="mt-0.5 text-sm text-ink-muted">{card.description}</div>
            </div>
            <span className="text-xl text-ink-muted">›</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
