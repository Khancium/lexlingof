"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type CropBox = { x: number; y: number; width: number; height: number };

/**
 * Self-built canvas cropper -- no third-party crop library. Shows the image
 * at a fixed on-screen display size, overlays a fixed-aspect-ratio crop box
 * the user can drag (move) and resize (bottom-right handle, aspect locked),
 * and on Apply draws exactly that region onto an offscreen canvas at the
 * caller's target output resolution.
 *
 * `imageSrc` must be same-origin or CORS-enabled (a local `URL.createObjectURL`
 * blob always is; a remote URL needs `Access-Control-Allow-Origin` -- Supabase
 * Storage's public URLs already send that, which is exactly why the "Crop"
 * action on an already-stored concept/scene image works against its own
 * publicUrl without a proxy).
 */
export function ImageCropper({
  imageSrc,
  aspectRatio,
  outputWidth,
  outputHeight,
  title,
  onCancel,
  onApply,
}: {
  imageSrc: string;
  aspectRatio: number;
  outputWidth: number;
  outputHeight: number;
  title: string;
  onCancel: () => void;
  onApply: (blob: Blob) => void | Promise<void>;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [displaySize, setDisplaySize] = useState<{ width: number; height: number } | null>(null);
  const [box, setBox] = useState<CropBox | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{ mode: "move" | "resize"; startX: number; startY: number; startBox: CropBox } | null>(null);

  const centerBox = useCallback(
    (display: { width: number; height: number }) => {
      // The largest crop box of the target aspect ratio that fits inside the
      // displayed image -- the equivalent of the server's own "cover" auto-crop,
      // shown here as the starting point for a manual adjustment.
      let width = display.width;
      let height = width / aspectRatio;
      if (height > display.height) {
        height = display.height;
        width = height * aspectRatio;
      }
      setBox({ x: (display.width - width) / 2, y: (display.height - height) / 2, width, height });
    },
    [aspectRatio],
  );

  function handleImageLoad() {
    const img = imgRef.current;
    if (!img) return;
    const natural = { width: img.naturalWidth, height: img.naturalHeight };
    setNaturalSize(natural);
    const display = { width: img.clientWidth, height: img.clientHeight };
    setDisplaySize(display);
    centerBox(display);
  }

  function startDrag(e: React.PointerEvent, mode: "move" | "resize") {
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, startBox: box };
  }

  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || !displaySize) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (drag.mode === "move") {
      const x = Math.min(Math.max(drag.startBox.x + dx, 0), displaySize.width - drag.startBox.width);
      const y = Math.min(Math.max(drag.startBox.y + dy, 0), displaySize.height - drag.startBox.height);
      setBox({ ...drag.startBox, x, y });
    } else {
      // Resize from the bottom-right handle, aspect locked to the target
      // ratio, bounded so the box never runs past the image edges.
      const maxWidth = displaySize.width - drag.startBox.x;
      const maxHeight = displaySize.height - drag.startBox.y;
      let width = Math.min(Math.max(drag.startBox.width + dx, 40), maxWidth);
      let height = width / aspectRatio;
      if (height > maxHeight) {
        height = maxHeight;
        width = height * aspectRatio;
      }
      setBox({ ...drag.startBox, width, height });
    }
  }

  function endDrag() {
    dragRef.current = null;
  }

  async function handleApply() {
    const img = imgRef.current;
    if (!img || !box || !naturalSize || !displaySize) return;
    setIsApplying(true);
    setError(null);
    try {
      // Map the on-screen crop box back to the image's natural pixel
      // dimensions, since the display size is scaled down to fit the modal.
      const scaleX = naturalSize.width / displaySize.width;
      const scaleY = naturalSize.height / displaySize.height;

      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported");

      ctx.drawImage(
        img,
        box.x * scaleX,
        box.y * scaleY,
        box.width * scaleX,
        box.height * scaleY,
        0,
        0,
        outputWidth,
        outputHeight,
      );

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) throw new Error("Failed to encode cropped image");
      await onApply(blob);
    } catch (err) {
      // A cross-origin image without CORS headers taints the canvas, which
      // throws a SecurityError on toBlob/getImageData rather than anything
      // more specific -- surfaced here as a plain message since there's no
      // finer-grained recovery the user can take from this dialog.
      setError(err instanceof Error ? err.message : "Failed to crop image");
    } finally {
      setIsApplying(false);
    }
  }

  useEffect(() => {
    function onResize() {
      const img = imgRef.current;
      if (!img) return;
      setDisplaySize({ width: img.clientWidth, height: img.clientHeight });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="card-duo w-full max-w-2xl rounded-2xl bg-surface p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          <button onClick={onCancel} className="text-sm font-semibold text-ink-muted hover:text-ink">
            Cancel
          </button>
        </div>

        <div
          ref={containerRef}
          className="relative mx-auto select-none overflow-hidden rounded-lg bg-black"
          style={{ maxHeight: "60vh", width: "fit-content" }}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {/* Third-party or arbitrary-URL images -- not run through next/image, same reasoning as the Openverse picker. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imgRef}
            src={imageSrc}
            alt=""
            crossOrigin="anonymous"
            onLoad={handleImageLoad}
            style={{ display: "block", maxHeight: "60vh", maxWidth: "80vw" }}
            draggable={false}
          />

          {box ? (
            <>
              {/* Four-piece dimmed overlay outside the crop box, so the box itself stays at full brightness without needing a cutout mask. */}
              <div className="pointer-events-none absolute inset-x-0 top-0 bg-black/50" style={{ height: box.y }} />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/50" style={{ top: box.y + box.height }} />
              <div className="pointer-events-none absolute bg-black/50" style={{ left: 0, top: box.y, width: box.x, height: box.height }} />
              <div
                className="pointer-events-none absolute bg-black/50"
                style={{ left: box.x + box.width, top: box.y, right: 0, height: box.height }}
              />

              <div
                onPointerDown={(e) => startDrag(e, "move")}
                className="absolute cursor-move ring-2 ring-white"
                style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
              >
                <div
                  onPointerDown={(e) => startDrag(e, "resize")}
                  className="absolute -bottom-2 -right-2 h-5 w-5 cursor-nwse-resize rounded-full border-2 border-white bg-brand"
                />
              </div>
            </>
          ) : null}
        </div>

        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => displaySize && centerBox(displaySize)}
            className="text-sm font-semibold text-brand hover:underline"
          >
            Reset to auto-crop
          </button>
          <button
            onClick={handleApply}
            disabled={isApplying || !box}
            className="btn-duo bg-brand px-5 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
          >
            {isApplying ? "Applying..." : "Apply Crop"}
          </button>
        </div>
      </div>
    </div>
  );
}
