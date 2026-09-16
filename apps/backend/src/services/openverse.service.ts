import { HttpError } from "../utils/http-error.js";

const OPENVERSE_API_BASE = "https://api.openverse.org/v1";
const SEARCH_TIMEOUT_MS = 10_000;

export type OpenverseImageResult = {
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
  /** Ready-to-store credit line, e.g. `"Sunset" by Jane Doe is licensed under CC-BY 4.0`. */
  attribution: string;
};

/**
 * Openverse's own auth_tokens endpoint: registering a free application
 * (https://api.openverse.org/v1/auth_tokens/register/) and setting
 * OPENVERSE_CLIENT_ID/OPENVERSE_CLIENT_SECRET raises the rate limit from the
 * anonymous tier (100 requests/day) to the authenticated tier (10,000/day).
 * Entirely optional -- unset, search just runs unauthenticated, same
 * "missing config degrades gracefully instead of failing" pattern as
 * Firebase push (notifications/push.service.ts).
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string | null> {
  const clientId = process.env.OPENVERSE_CLIENT_ID;
  const clientSecret = process.env.OPENVERSE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return null;
  }

  // 60s safety margin so a token doesn't expire mid-request.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const response = await fetch(`${OPENVERSE_API_BASE}/auth_tokens/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }).toString(),
  });

  if (!response.ok) {
    console.error(`[openverse] failed to obtain access token (HTTP ${response.status}), falling back to anonymous requests`);
    return null;
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

/**
 * Fallback only -- Openverse's own `attribution` field (used directly below)
 * is more complete than anything reconstructed here: it already reads e.g.
 * `"Birch Trees" by saaby is licensed under CC BY-SA 2.0. To view a copy of
 * this license, visit https://creativecommons.org/licenses/by-sa/2.0/.`,
 * including the license URL. This only exists for the case where that field
 * is ever missing (an image submitted before it existed, say).
 */
export function buildAttribution(result: {
  title: string | null;
  creator: string | null;
  license: string;
  licenseVersion: string | null;
}): string {
  const title = result.title ? `"${result.title}"` : "This image";
  const creator = result.creator ? ` by ${result.creator}` : "";
  const license = result.licenseVersion ? `CC ${result.license.toUpperCase()} ${result.licenseVersion}` : `CC ${result.license.toUpperCase()}`;
  return `${title}${creator} is licensed under ${license}`;
}

export type OpenverseSearchResponse = {
  results: OpenverseImageResult[];
  resultCount: number;
  pageCount: number;
  page: number;
};

/**
 * Searches Openverse's aggregated catalog of openly-licensed images
 * (Flickr, Wikimedia Commons, museum collections, etc.). Filtered to
 * `license_type=commercial,modification` by default -- every image the app
 * stores gets resized and re-encoded to WebP (storage.service.ts), which is
 * a "modification", and the corpus itself may end up redistributed, so a
 * license that forbids either isn't actually usable here even if it turned
 * up in an unfiltered search.
 */
export async function searchOpenverseImages(
  query: string,
  opts: { page?: number; pageSize?: number } = {},
): Promise<OpenverseSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new HttpError(400, "INVALID_QUERY", "Search query cannot be empty");
  }

  const params = new URLSearchParams({
    q: trimmed,
    page: String(opts.page ?? 1),
    page_size: String(Math.min(opts.pageSize ?? 20, 40)),
    license_type: "commercial,modification",
    mature: "false",
  });

  const token = await getAccessToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${OPENVERSE_API_BASE}/images/?${params.toString()}`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    throw new HttpError(502, "OPENVERSE_UNREACHABLE", "Could not reach Openverse -- try again in a moment");
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429) {
    throw new HttpError(429, "OPENVERSE_RATE_LIMITED", "Openverse rate limit reached -- try again shortly");
  }
  if (!response.ok) {
    throw new HttpError(502, "OPENVERSE_ERROR", `Openverse search failed (HTTP ${response.status})`);
  }

  const data = (await response.json()) as {
    result_count: number;
    page_count: number;
    results: Array<{
      id: string;
      title: string | null;
      creator: string | null;
      creator_url: string | null;
      url: string;
      thumbnail: string | null;
      foreign_landing_url: string;
      license: string;
      license_version: string | null;
      provider: string | null;
      width: number | null;
      height: number | null;
      attribution: string | null;
    }>;
  };

  const results: OpenverseImageResult[] = data.results.map((r) => ({
    id: r.id,
    title: r.title,
    creator: r.creator,
    creatorUrl: r.creator_url,
    url: r.url,
    thumbnail: r.thumbnail,
    foreignLandingUrl: r.foreign_landing_url,
    license: r.license,
    licenseVersion: r.license_version,
    provider: r.provider,
    width: r.width,
    height: r.height,
    attribution:
      r.attribution ?? buildAttribution({ title: r.title, creator: r.creator, license: r.license, licenseVersion: r.license_version }),
  }));

  return { results, resultCount: data.result_count, pageCount: data.page_count, page: opts.page ?? 1 };
}
