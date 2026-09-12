"use client";

import { useState } from "react";
import { api, getErrorMessage, type AdminUser } from "@/lib/api";

type ActionType = "restrict" | "cooloff";

/** Restrict (blocks new submissions, login still works) and Cool-off (blocks login for N days) used to be two separate buttons -- combined into one action picker since they're both "apply a penalty" actions on the same user. */
export function AdminUserActionModal({
  user,
  onClose,
  onDone,
}: {
  user: AdminUser;
  onClose: () => void;
  onDone: () => void;
}) {
  const [actionType, setActionType] = useState<ActionType>("restrict");
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("7");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (reason.trim().length === 0) {
      setError("A reason is required.");
      return;
    }
    if (actionType === "cooloff") {
      const parsedDays = Number(days);
      if (!Number.isFinite(parsedDays) || parsedDays < 1) {
        setError("Enter a whole number of days (1 or more).");
        return;
      }
    }
    setIsSubmitting(true);
    setError(null);
    try {
      if (actionType === "restrict") {
        await api.admin.restrictUser(user.id, reason.trim());
      } else {
        await api.admin.cooloffUser(user.id, reason.trim(), Math.round(Number(days)));
      }
      onDone();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to apply action"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="card-duo w-full max-w-sm rounded-2xl bg-surface p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-ink">Restrict / Cool-off {user.displayName}</h2>

        <div className="mt-4 space-y-2">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="radio" checked={actionType === "restrict"} onChange={() => setActionType("restrict")} />
            <span>
              <span className="font-semibold">Restrict</span> -- blocks new contribution submissions, they can still log in
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="radio" checked={actionType === "cooloff"} onChange={() => setActionType("cooloff")} />
            <span>
              <span className="font-semibold">Cool-off</span> -- blocks login entirely for a set number of days
            </span>
          </label>
        </div>

        {actionType === "cooloff" ? (
          <div className="mt-3">
            <label className="mb-1 block text-xs font-semibold text-ink-muted">Days</label>
            <input
              type="number"
              min={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-24 rounded-lg bg-surface-card px-3 py-2 text-sm text-ink ring-1 ring-border"
            />
          </div>
        ) : null}

        <div className="mt-3">
          <label className="mb-1 block text-xs font-semibold text-ink-muted">Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Why is this action being taken?"
            className="w-full rounded-lg bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border"
          />
        </div>

        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="btn-duo btn-duo-secondary flex-1 bg-surface-card py-2.5 text-sm font-semibold text-ink hover:bg-border"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="btn-duo flex-1 bg-amber-500 py-2.5 text-sm font-semibold text-white hover:bg-amber-400 disabled:opacity-50"
          >
            {isSubmitting ? "Applying..." : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
