import { HttpError } from "../utils/http-error.js";

const COMMONS_API_BASE = "https://commons.wikimedia.org/w/api.php";
const SEARCH_TIMEOUT_MS = 10_000;
// Wikimedia's API etiquette requires every client to identify itself with a
// descriptive User-Agent (unauthenticated/anonymous-looking traffic is the
// first thing their ops team rate-limits or blocks) -- same reasoning as the
// browser-like header storage.service.ts sends when fetching an admin-
// submitted image URL, just a different target.
const USER_AGENT = "Lexlingo/1.0 (https://github.com/Khancium/lexlingof)";

export type WikimediaImageResult = {
  id: string;
  title: string | null;
  creator: string | null;
  creatorUrl: string | null;
  url: string;
  thumbnail: string | null;
  foreignLandingUrl: string;
  license: string;
  licenseVersion: string | null;
  provider: string | null;
  width: number | null;
  height: number | null;
  /** Ready-to-store credit line, e.g. `"Sunset.jpg" by Jane Doe (Wikimedia Commons), CC BY-SA 4.0`. */
  attribution: string;
};

export type WikimediaSearchResponse = {
  results: WikimediaImageResult[];
  resultCount: number;
  pageCount: number;
  page: number;
};

/** Strips the handful of HTML tags Commons' extmetadata values (Artist, Credit) commonly contain, e.g. `<a href="...">Jane Doe</a>` -> `Jane Doe`. */
function stripHtml(value: string | undefined): string | null {
  if (!value) return null;
  const text = value.replace(/<[^>]+>/g, "").trim();
  return text.length > 0 ? text : null;
}

/** The first `href` in an HTML snippet, if any -- used to recover a creator's profile link out of the Artist field. */
function firstHref(value: string | undefined): string | null {
  const match = value?.match(/href="([^"]+)"/);
  return match?.[1] ?? null;
}

/**
 * Commons' `License` extmetadata value is a short machine slug (`cc-by-sa-4.0`,
 * `cc0`, `pd`, `public domain`, ...), not the structured `license_type`
 * Openverse exposes. Same commercial-use-and-modification policy as
 * openverse.service.ts (every stored image gets re-encoded to WebP, and the
 * corpus may be redistributed) -- reject anything tagged non-commercial
 * (`nc`) or no-derivatives (`nd`); everything else (CC0, public domain, CC
 * BY, CC BY-SA, and unlabeled-but-"PD"-ish values) is allowed through.
 */
function isUsableLicense(licenseSlug: string | undefined): boolean {
  if (!licenseSlug) return false;
  const slug = licenseSlug.toLowerCase();
  if (/(^|-)(nc|nd)(-|$)/.test(slug)) return false;
  return /^(cc0|cc-zero|pd|pdm|public[-_ ]?domain|cc-by(-sa)?(-\d)?)/.test(slug) || slug.includes("public domain");
}

function parseLicense(licenseSlug: string | undefined): { license: string; licenseVersion: string | null } {
  const slug = (licenseSlug ?? "unknown").toLowerCase();
  const versionMatch = slug.match(/(\d+(\.\d+)?)$/);
  const license = slug.replace(/-\d+(\.\d+)?$/, "").toUpperCase();
  return { license, licenseVersion: versionMatch?.[1] ?? null };
}

function buildAttribution(result: {
  title: string | null;
  creator: string | null;
  license: string;
  licenseVersion: string | null;
}): string {
  const title = result.title ? `"${result.title}"` : "This image";
  const creator = result.creator ? ` by ${result.creator}` : "";
  const license = result.licenseVersion ? `CC ${result.license} ${result.licenseVersion}` : result.license;
  return `${title}${creator}, via Wikimedia Commons, ${license}`;
}

type CommonsImageInfo = {
  url: string;
  descriptionurl: string;
  thumburl?: string;
  width: number;
  height: number;
  mime: string;
  extmetadata?: Record<string, { value?: string } | undefined>;
};

type CommonsPage = {
  pageid: number;
  title: string;
  imageinfo?: CommonsImageInfo[];
};

type CommonsResponse = {
  query?: {
    pages?: CommonsPage[];
    searchinfo?: { totalhits?: number };
  };
};

/**
 * Searches Wikimedia Commons' own media library directly (distinct from
 * Openverse, which aggregates Commons among many other sources but applies
 * its own cropping/caching layer) -- useful when an admin wants to search
 * Commons' much larger catalog, or find an image Openverse hasn't indexed
 * yet. Results are filtered down to the File: namespace and to
 * commercial-use/derivative-friendly licenses, same policy as Openverse.
 */
export async function searchWikimediaImages(
  query: string,
  opts: { page?: number; pageSize?: number } = {},
): Promise<WikimediaSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new HttpError(400, "INVALID_QUERY", "Search query cannot be empty");
  }

  const page = opts.page ?? 1;
  const pageSize = Math.min(opts.pageSize ?? 20, 40);
  const offset = (page - 1) * pageSize;

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: trimmed,
    gsrnamespace: "6", // File:
    gsrlimit: String(pageSize),
    gsroffset: String(offset),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata|mime",
    iiurlwidth: "320",
    list: "search",
    srsearch: trimmed,
    srnamespace: "6",
    srlimit: "1",
    srinfo: "totalhits",
    origin: "*",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${COMMONS_API_BASE}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
  } catch {
    throw new HttpError(502, "WIKIMEDIA_UNREACHABLE", "Could not reach Wikimedia Commons -- try again in a moment");
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429) {
    throw new HttpError(429, "WIKIMEDIA_RATE_LIMITED", "Wikimedia Commons rate limit reached -- try again shortly");
  }
  if (!response.ok) {
    throw new HttpError(502, "WIKIMEDIA_ERROR", `Wikimedia Commons search failed (HTTP ${response.status})`);
  }

  const data = (await response.json()) as CommonsResponse;
  const pages = data.query?.pages ?? [];
  const totalHits = data.query?.searchinfo?.totalhits ?? pages.length;

  const results: WikimediaImageResult[] = [];
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info || !info.mime?.startsWith("image/")) continue;

    const meta = info.extmetadata ?? {};
    const licenseSlug = meta.License?.value;
    if (!isUsableLicense(licenseSlug)) continue;

    const { license, licenseVersion } = parseLicense(licenseSlug);
    const title = p.title.replace(/^File:/, "");
    const creator = stripHtml(meta.Artist?.value) ?? stripHtml(meta.Credit?.value);
    const creatorUrl = firstHref(meta.Artist?.value);

    results.push({
      id: String(p.pageid),
      title,
      creator,
      creatorUrl,
      url: info.url,
      thumbnail: info.thumburl ?? null,
      foreignLandingUrl: info.descriptionurl,
      license,
      licenseVersion,
      provider: "wikimedia_commons",
      width: info.width ?? null,
      height: info.height ?? null,
      attribution: buildAttribution({ title, creator, license, licenseVersion }),
    });
  }

  return {
    results,
    resultCount: totalHits,
    pageCount: Math.max(1, Math.ceil(totalHits / pageSize)),
    page,
  };
}
