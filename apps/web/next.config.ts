import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Concept/scene images live in Supabase Storage -- letting next/image
    // optimize them means even already-uploaded full-resolution originals
    // get resized/re-encoded on the fly for the small thumbnails they're
    // actually shown at, instead of shipping the original bytes.
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" }],
  },
};

export default nextConfig;
