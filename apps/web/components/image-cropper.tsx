"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type CropBox = { x: number; y: number; width: number; height: number };

const MIN_BOX_SIZE = 40;

/** Which edges each resize handle drags -- 'e'/'w' affect width, 'n'/'s' affect height, corners affect both. The substring trick (`handle.includes("e")` etc.) relies on these exact two-letter corner spellings. */
const FREE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type HandleId = (typeof FREE_HANDLES)[number];

const HANDLE_STYLE: Record<HandleId, { left: string; top: string; cursor: string }> = {
  nw: { left: "0%", top: "0%", cursor: "cursor-nwse-resize" },
  n: { left: "50%", top: "0%", cursor: "cursor-ns-resize" },
  ne: { left: "100%", top: "0%", cursor: "cursor-nesw-resize" },
  e: { left: "100%", top: "50%", cursor: "cursor-ew-resize" },
  se: { left: "100%", top: "100%", cursor: "cursor-nwse-resize" },
  s: { left: "50%", top: "100%", cursor: "cursor-ns-resize" },
  sw: { left: "0%", top: "100%", cursor: "cursor-nesw-resize" },
  w: { left: "0%", top: "50%", cursor: "cursor-ew-resize" },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// How much smaller than the output the blurred backdrop is drawn first, and how
// many steps it is enlarged back up in. Small enlargement steps (about 2x each)
// keep it smooth; a single big jump leaves visible blocks and creases.
const BACKDROP_SCALE_DOWN = 16;
const BACKDROP_STEPS = 4;

function newCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { canvas, ctx };
}

/**
 * Draws the WHOLE image, scaled to just fit and centred, onto a width x height
 * canvas, with the area it doesn't reach filled by a soft blurred copy of the
 * image itself. Nothing is cut off and nothing is stretched. This is the
 * browser-side twin of the server's `fitInsideFrame` (backend
 * utils/image-frame.ts), which frames every upload that did NOT come through
 * here (a URL, Openverse, Wikimedia) the same way.
 *
 * The backdrop is the image drawn small and enlarged again in steps, which is
 * already soft; where the browser supports `ctx.filter` (Safari does not) the
 * last enlargement also gets a real blur, so it matches the server's look.
 */
function renderWholeImage(img: HTMLImageElement, width: number, height: number): HTMLCanvasElement {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const { canvas, ctx } = newCanvas(width, height);

  // Backdrop, step 0: the image covering a small frame.
  const smallW = Math.max(2, Math.round(width / BACKDROP_SCALE_DOWN));
  const smallH = Math.max(2, Math.round(height / BACKDROP_SCALE_DOWN));
  let stage = newCanvas(smallW, smallH);
  const coverScale = Math.max(smallW / nw, smallH / nh);
  const sourceW = smallW / coverScale;
  const sourceH = smallH / coverScale;
  stage.ctx.drawImage(img, (nw - sourceW) / 2, (nh - sourceH) / 2, sourceW, sourceH, 0, 0, smallW, smallH);

  // Steps 1..n-1: enlarge by an equal factor each time.
  const factor = Math.pow(BACKDROP_SCALE_DOWN, 1 / BACKDROP_STEPS);
  for (let i = 1; i < BACKDROP_STEPS; i++) {
    const next = newCanvas(Math.round(stage.canvas.width * factor), Math.round(stage.canvas.height * factor));
    next.ctx.drawImage(stage.canvas, 0, 0, next.canvas.width, next.canvas.height);
    stage = next;
  }

  // Last step: onto the output, blurred when possible. A blur reads past the
  // canvas edge (as transparent), so draw it a little oversized to keep the
  // edges from fading.
  const sigma = Math.max(1, Math.round(width / 160));
  const canBlur = typeof ctx.filter === "string";
  const pad = canBlur ? sigma * 3 : 0;
  if (canBlur) ctx.filter = `blur(${sigma}px)`;
  ctx.drawImage(stage.canvas, -pad, -pad, width + 2 * pad, height + 2 * pad);
  if (canBlur) ctx.filter = "none";

  // Foreground: the whole image, as large as fits.
  const scale = Math.min(width / nw, height / nh);
  const drawW = Math.round(nw * scale);
  const drawH = Math.round(nh * scale);
  ctx.drawImage(img, Math.floor((width - drawW) / 2), Math.floor((height - drawH) / 2), drawW, drawH);

  return canvas;
}

/** Independent-per-edge resize (no ratio lock) -- used when aspectRatio is null. Each edge the handle touches moves by its own delta; the opposite edge stays put. */
function resizeFree(handle: HandleId, dx: number, dy: number, start: CropBox, display: { width: number; height: number }): CropBox {
  let { x, y, width, height } = start;

  if (handle.includes("e")) {
    width = clamp(start.width + dx, MIN_BOX_SIZE, display.width - start.x);
  }
  if (handle.includes("w")) {
    const clampedDx = clamp(dx, -start.x, start.width - MIN_BOX_SIZE);
    x = start.x + clampedDx;
    width = start.width - clampedDx;
  }
  if (handle.includes("s")) {
    height = clamp(start.height + dy, MIN_BOX_SIZE, display.height - start.y);
  }
  if (handle.includes("n")) {
    const clampedDy = clamp(dy, -start.y, start.height - MIN_BOX_SIZE);
    y = start.y + clampedDy;
    height = start.height - clampedDy;
  }

  return { x, y, width, height };
}

/**
 * Self-built canvas cropper -- no third-party crop library. Shows the image
 * at a fixed on-screen display size and overlays a crop box the user can
 * drag (move) and resize, then on Apply draws exactly that region onto an
 * offscreen canvas.
 *
 * Two modes, picked by `aspectRatio`:
 *  - A number: the box is locked to that ratio (the original behavior --
 *    single bottom-right handle, output forced to exactly
 *    outputWidth x outputHeight).
 *  - null: free-form -- all 8 edge/corner handles, any rectangle, any ratio.
 *    The output canvas is sized to the crop's own natural pixel dimensions
 *    (scaled down to fit within outputWidth as a max long edge) so nothing
 *    gets stretched to fit a ratio the user didn't choose.
 *
 * In ratio-locked mode `allowWholeImage` adds a second way out that cuts
 * nothing: "Use whole image" fits the entire picture inside the output frame
 * and fills the rest with a blurred copy of it (see renderWholeImage).
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
  allowWholeImage = false,
  onCancel,
  onApply,
}: {
  imageSrc: string;
  aspectRatio: number | null;
  outputWidth: number;
  outputHeight: number;
  title: string;
  /**
   * Adds a "Use whole image" action (ratio-locked mode only): instead of
   * cutting a box out of the picture, fit all of it inside the output frame
   * and fill the rest with a soft blur of the picture. For a NEW picture this
   * is the primary action; for re-cropping one that is already stored it is
   * left off, since a stored image already is the frame.
   */
  allowWholeImage?: boolean;
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
  const dragRef = useRef<{ mode: "move" | "resize"; handle?: HandleId; startX: number; startY: number; startBox: CropBox } | null>(null);

  const centerBox = useCallback(
    (display: { width: number; height: number }) => {
      if (aspectRatio == null) {
        // Free mode: start at 80% of the displayed image, centered -- no ratio to aim for.
        const width = display.width * 0.8;
        const height = display.height * 0.8;
        setBox({ x: (display.width - width) / 2, y: (display.height - height) / 2, width, height });
        return;
      }
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

  function startDrag(e: React.PointerEvent, mode: "move" | "resize", handle?: HandleId) {
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { mode, handle, startX: e.clientX, startY: e.clientY, startBox: box };
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
    } else if (aspectRatio == null && drag.handle) {
      setBox(resizeFree(drag.handle, dx, dy, drag.startBox, displaySize));
    } else {
      // Ratio-locked resize from the bottom-right corner, bounded so the box never runs past the image edges.
      const maxWidth = displaySize.width - drag.startBox.x;
      const maxHeight = displaySize.height - drag.startBox.y;
      let width = Math.min(Math.max(drag.startBox.width + dx, MIN_BOX_SIZE), maxWidth);
      let height = width / (aspectRatio ?? 1);
      if (height > maxHeight) {
        height = maxHeight;
        width = height * (aspectRatio ?? 1);
      }
      setBox({ ...drag.startBox, width, height });
    }
  }

  function endDrag() {
    dragRef.current = null;
  }

  /** Draws the cropped region onto a canvas of the output size (or, free-form, of the crop's own size). */
  function renderCrop(img: HTMLImageElement, currentBox: CropBox, natural: { width: number; height: number }, display: { width: number; height: number }) {
    // Map the on-screen crop box back to the image's natural pixel
    // dimensions, since the display size is scaled down to fit the modal.
    const scaleX = natural.width / display.width;
    const scaleY = natural.height / display.height;
    const sourceX = currentBox.x * scaleX;
    const sourceY = currentBox.y * scaleY;
    const sourceWidth = currentBox.width * scaleX;
    const sourceHeight = currentBox.height * scaleY;

    let canvasWidth = outputWidth;
    let canvasHeight = outputHeight;
    if (aspectRatio == null) {
      // Preserve the crop's own aspect ratio -- never stretch a free-form
      // selection to fit a fixed ratio it wasn't drawn to. outputWidth is
      // treated as a max long edge here, not a forced width.
      canvasWidth = sourceWidth;
      canvasHeight = sourceHeight;
      const longEdge = Math.max(canvasWidth, canvasHeight);
      if (longEdge > outputWidth) {
        const scale = outputWidth / longEdge;
        canvasWidth = Math.round(canvasWidth * scale);
        canvasHeight = Math.round(canvasHeight * scale);
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");

    ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvasWidth, canvasHeight);
    return canvas;
  }

  /** Renders (via `render`), encodes and hands the result to the caller; shared by "Apply Crop" and "Use whole image". */
  async function finish(render: (img: HTMLImageElement) => HTMLCanvasElement) {
    const img = imgRef.current;
    if (!img || !naturalSize) return;
    setIsApplying(true);
    setError(null);
    try {
      const canvas = render(img);
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

  function handleApply() {
    if (!box || !naturalSize || !displaySize) return;
    return finish((img) => renderCrop(img, box, naturalSize, displaySize));
  }

  function handleUseWholeImage() {
    return finish((img) => renderWholeImage(img, outputWidth, outputHeight));
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

  const showWholeImage = allowWholeImage && aspectRatio != null;

  // Rendered through a portal on <body>: the admin "Images -> Crop" button
  // opens this from inside a table card that has a CSS transform, and a
  // transformed ancestor turns `position: fixed` into "fixed to that card" --
  // the dialog was clipped to the table, off-centre, and its resize handle
  // could land off-screen. On <body> it always covers the viewport.
  if (typeof document === "undefined") return null;

  return createPortal(
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
          style={{ maxHeight: "60vh", width: "fit-content", maxWidth: "100%" }}
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
            style={{ display: "block", maxHeight: "60vh", maxWidth: "100%" }}
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
                {aspectRatio == null ? (
                  FREE_HANDLES.map((h) => (
                    <div
                      key={h}
                      onPointerDown={(e) => startDrag(e, "resize", h)}
                      className={`absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand ${HANDLE_STYLE[h].cursor}`}
                      style={{ left: HANDLE_STYLE[h].left, top: HANDLE_STYLE[h].top }}
                    />
                  ))
                ) : (
                  <div
                    onPointerDown={(e) => startDrag(e, "resize", "se")}
                    className="absolute -bottom-2 -right-2 h-5 w-5 cursor-nwse-resize rounded-full border-2 border-white bg-brand"
                  />
                )}
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
            Reset
          </button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {showWholeImage ? (
              <button
                type="button"
                onClick={handleUseWholeImage}
                disabled={isApplying || !naturalSize}
                className="btn-duo bg-brand px-5 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
              >
                {isApplying ? "Applying..." : "Use whole image"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleApply}
              disabled={isApplying || !box}
              className={
                showWholeImage
                  ? "rounded-xl border-2 border-border px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-card disabled:opacity-50"
                  : "btn-duo bg-brand px-5 py-2 text-sm font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
              }
            >
              {showWholeImage ? "Crop to the box" : isApplying ? "Applying..." : "Apply Crop"}
            </button>
          </div>
        </div>
        {showWholeImage ? (
          <p className="mt-3 text-xs text-ink-muted">
            <span className="font-semibold">Use whole image</span> keeps the entire picture and fills the sides (or top and bottom) with a soft
            blur of it. <span className="font-semibold">Crop to the box</span> keeps only the part inside the white box; the shaded part is cut off.
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
