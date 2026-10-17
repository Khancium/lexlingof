import type { NextConfig } from "next";

// Kept deliberately permissive where the app genuinely needs it (inline
// scripts/styles for Next.js hydration and styled-jsx, third-party image
// `<img>` sources in the admin Openverse/Wikimedia pickers which aren't run
// through next/image) -- the goal here is defense-in-depth against
// exfiltration if an XSS ever lands (connect-src/media-src stop it from
// phoning home or streaming data to an attacker-controlled origin), not a
// zero-inline-script lockdown, which would need a nonce-based rework this
// pass didn't attempt.
const apiOrigin = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: https:",
  "font-src 'self' https://fonts.gstatic.com data:",
  `connect-src 'self' ${apiOrigin}`,
  "media-src 'self' https://*.r2.cloudflarestorage.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const nextConfig: NextConfig = {
  images: {
    // Concept/scene images live in Supabase Storage -- letting next/image
    // optimize them means even already-uploaded full-resolution originals
    // get resized/re-encoded on the fly for the small thumbnails they're
    // actually shown at, instead of shipping the original bytes.
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" }],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
