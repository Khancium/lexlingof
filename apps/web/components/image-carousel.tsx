"use client";

import { useRef, useState } from "react";
import Image from "next/image";

/**
 * A concept can have more than one photo (e.g. different angles of the same
 * object) -- this shows them as a native horizontal scroll-snap carousel
 * (free touch-swipe on mobile, no JS drag handling needed) with dot
 * indicators and desktop arrow buttons. Renders a single plain image with no
 * chrome at all when there's only one, so nothing changes for the common
 * case.
 */
export function ImageCarousel({
  images,
  alt,
  heightClassName = "h-56",
  roundedClassName = "sm:rounded-2xl",
}: {
  images: { id: string; publicUrl: string }[];
  alt: string;
  heightClassName?: string;
  roundedClassName?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  function scrollToIndex(index: number) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: index * track.clientWidth, behavior: "smooth" });
  }

  function handleScroll() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    setActiveIndex(Math.round(track.scrollLeft / track.clientWidth));
  }

  if (images.length === 0) {
    return (
      <div className={`flex w-full items-center justify-center bg-surface-card text-5xl ${heightClassName} ${roundedClassName}`}>
        🖼️
      </div>
    );
  }

  if (images.length === 1) {
    return (
      <div className={`relative w-full overflow-hidden ${heightClassName} ${roundedClassName}`}>
        <Image src={images[0]!.publicUrl} alt={alt} fill sizes="100vw" className="object-cover" priority />
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={trackRef}
        onScroll={handleScroll}
        className={`flex w-full snap-x snap-mandatory overflow-x-auto scroll-smooth ${roundedClassName}`}
        style={{ scrollbarWidth: "none" }}
      >
        {images.map((image, i) => (
          <div key={image.id} className={`relative w-full shrink-0 snap-center ${heightClassName}`}>
            <Image src={image.publicUrl} alt={`${alt} (${i + 1} of ${images.length})`} fill sizes="100vw" className="object-cover" priority={i === 0} />
          </div>
        ))}
      </div>

      {/* Arrows -- hidden on touch devices via pointer:coarse, since swipe
         already covers them there; kept for mouse/trackpad users. */}
      {activeIndex > 0 ? (
        <button
          type="button"
          onClick={() => scrollToIndex(activeIndex - 1)}
          aria-label="Previous image"
          className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-black/60 [@media(hover:hover)]:flex"
        >
          ←
        </button>
      ) : null}
      {activeIndex < images.length - 1 ? (
        <button
          type="button"
          onClick={() => scrollToIndex(activeIndex + 1)}
          aria-label="Next image"
          className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-black/60 [@media(hover:hover)]:flex"
        >
          →
        </button>
      ) : null}

      <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
        {images.map((image, i) => (
          <button
            key={image.id}
            type="button"
            onClick={() => scrollToIndex(i)}
            aria-label={`Go to image ${i + 1}`}
            className={`h-1.5 rounded-full transition-all ${i === activeIndex ? "w-4 bg-white" : "w-1.5 bg-white/60"}`}
          />
        ))}
      </div>
    </div>
  );
}
