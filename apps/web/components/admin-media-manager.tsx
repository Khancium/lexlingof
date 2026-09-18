"use client";

import { useEffect, useState } from "react";
import type { ConceptMedia, SceneMedia } from "@/lib/api";
import { ImageCropper } from "@/components/image-cropper";

type MediaItem = ConceptMedia | SceneMedia;

/**
 * Thumbnail grid with a remove + crop button per image -- shared by the
 * concepts and scenes admin pages. Covers an image regardless of how it got
 * there (multipart upload, "From URL", or Openverse): all three funnel
 * through the same conceptMedia/sceneMedia row and end up re-hosted on
 * Supabase Storage, so one component handles removal and manual re-cropping
 * for all of them uniformly -- the crop tool loads the image from its own
 * publicUrl, which Supabase Storage always serves with permissive CORS
 * headers, so the canvas never gets tainted regardless of original source.
 */
export function AdminMediaManager({
  itemId,
  aspectRatio,
  outputWidth,
  outputHeight,
  getMedia,
  deleteMedia,
  cropMedia,
  onChanged,
}: {
  itemId: string;
  aspectRatio: number;
  outputWidth: number;
  outputHeight: number;
  getMedia: (id: string) => Promise<MediaItem[]>;
  deleteMedia: (id: string, mediaId: string) => Promise<unknown>;
  cropMedia: (id: string, mediaId: string, file: File) => Promise<unknown>;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [croppingId, setCroppingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getMedia(itemId)
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load images"))
      .finally(() => setLoading(false));
    // getMedia/deleteMedia/cropMedia are stable function references passed by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  async function handleDelete(mediaId: string) {
    if (!window.confirm("Remove this image? This deletes it from storage too and cannot be undone.")) return;
    setDeletingId(mediaId);
    setError(null);
    const previous = items;
    setItems((prev) => prev.filter((m) => m.id !== mediaId));
    try {
      await deleteMedia(itemId, mediaId);
      onChanged?.();
    } catch (err) {
      setItems(previous);
      setError(err instanceof Error ? err.message : "Failed to remove image");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleCropApply(mediaId: string, blob: Blob) {
    const file = new File([blob], "cropped.jpg", { type: "image/jpeg" });
    await cropMedia(itemId, mediaId, file);
    setCroppingId(null);
    const refreshed = await getMedia(itemId);
    setItems(refreshed);
    onChanged?.();
  }

  if (loading) {
    return <p className="text-sm text-ink-muted">Loading images...</p>;
  }

  const cropTarget = items.find((m) => m.id === croppingId);

  return (
    <div className="space-y-2">
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">No images yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {items.map((m) => (
            <div key={m.id} className="relative overflow-hidden rounded-lg ring-1 ring-border">
              {m.publicUrl ? (
                // Third-party-sourced images (Openverse, arbitrary "From URL"
                // links) aren't run through next/image -- see the identical
                // note in admin-openverse-picker.tsx.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.publicUrl} alt="" className="h-24 w-full object-cover" />
              ) : (
                <div className="flex h-24 items-center justify-center bg-surface-card text-xs text-ink-muted">No preview</div>
              )}
              <div className="bg-surface-card p-1.5 text-[10px] text-ink-muted">
                {m.isPrimary ? <span className="font-semibold text-brand">Primary</span> : null}
                {m.sourceProvider ? <span className="ml-1 capitalize">{m.sourceProvider}</span> : null}
              </div>
              <div className="absolute right-1 top-1 flex gap-1">
                {m.publicUrl ? (
                  <button
                    onClick={() => setCroppingId(m.id)}
                    className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-brand"
                  >
                    Crop
                  </button>
                ) : null}
                <button
                  onClick={() => handleDelete(m.id)}
                  disabled={deletingId === m.id}
                  className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                >
                  {deletingId === m.id ? "..." : "Remove"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {cropTarget?.publicUrl ? (
        <ImageCropper
          imageSrc={cropTarget.publicUrl}
          aspectRatio={aspectRatio}
          outputWidth={outputWidth}
          outputHeight={outputHeight}
          title="Crop image"
          onCancel={() => setCroppingId(null)}
          onApply={(blob) => handleCropApply(cropTarget.id, blob)}
        />
      ) : null}
    </div>
  );
}
