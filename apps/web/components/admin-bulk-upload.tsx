"use client";

import { useState } from "react";
import type { BulkUploadResult } from "@/lib/api";

export function AdminBulkUpload({
  label,
  onUpload,
  onDone,
}: {
  label: string;
  onUpload: (file: File) => Promise<BulkUploadResult>;
  onDone?: () => void;
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<BulkUploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setIsUploading(true);
    setError(null);
    setResult(null);
    try {
      const res = await onUpload(file);
      setResult(res);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-ink">{label}</h2>
        <label className="cursor-pointer rounded-full bg-surface-card px-4 py-2 text-sm font-semibold text-ink hover:bg-border">
          {isUploading ? "Uploading..." : "Choose File (.csv, .json)"}
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            className="hidden"
            disabled={isUploading}
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {result ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-emerald-600">{result.created} row(s) created.</p>
          {result.errors.length > 0 ? (
            <div className="max-h-40 overflow-y-auto rounded-lg bg-surface-card p-3 text-xs text-red-600">
              {result.errors.map((e) => (
                <p key={e.row}>
                  Row {e.row}: {e.message}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
