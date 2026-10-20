import Link from "next/link";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Renders inline **bold** within an otherwise-plain line of text. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{part}</span>
    ),
  );
}

/**
 * The terms content (content/terms.ts on the backend) only ever uses a small,
 * predictable markdown subset -- # / ## headers, **bold**, "- " bullet
 * lists, and blank-line-separated paragraphs -- so a tiny hand-rolled
 * renderer here avoids pulling in a markdown library for one static page.
 */
function renderTermsContent(markdown: string) {
  const lines = markdown.split("\n");
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];

  function flushList() {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`list-${blocks.length}`} className="list-disc space-y-1 pl-6">
        {listItems.map((item, i) => (
          <li key={i}>{renderInline(item, `li-${blocks.length}-${i}`)}</li>
        ))}
      </ul>,
    );
    listItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith("- ")) {
      listItems.push(line.slice(2));
      continue;
    }
    flushList();
    if (line.startsWith("## ")) {
      blocks.push(
        <h2 key={blocks.length} className="mt-6 text-lg font-bold text-ink">
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith("# ")) {
      blocks.push(
        <h1 key={blocks.length} className="text-2xl font-bold text-ink">
          {line.slice(2)}
        </h1>,
      );
    } else if (line.length > 0) {
      blocks.push(
        <p key={blocks.length} className="text-sm leading-relaxed text-ink-muted">
          {renderInline(line, `p-${blocks.length}`)}
        </p>,
      );
    }
  }
  flushList();
  return blocks;
}

async function getTerms() {
  try {
    return await api.terms.get();
  } catch {
    return null;
  }
}

export default async function TermsPage() {
  const terms = await getTerms();

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-10">
      <Link href="/" className="text-sm font-medium text-brand hover:underline">
        ← Back to Lexlingo
      </Link>

      <div className="card-duo space-y-3 rounded-3xl border border-border bg-surface p-8 shadow-sm">
        {terms ? (
          renderTermsContent(terms.content)
        ) : (
          <p className="text-sm text-red-600">Could not load the Terms and Conditions right now -- please try again shortly.</p>
        )}
      </div>
    </div>
  );
}
