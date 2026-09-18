"use client";

import { useState } from "react";
import { api, getErrorMessage, type AdminUser } from "@/lib/api";

/** Lets an admin/super_admin reset a locked-out user's email, password, and/or display name. Mirrors AdminUserActionModal's layout -- same modal shell, same submit/cancel footer. */
export function AdminUserCredentialsModal({
  user,
  onClose,
  onDone,
}: {
  user: AdminUser;
  onClose: () => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState(user.displayName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    const trimmedEmail = email.trim();
    const trimmedName = displayName.trim();

    if (!trimmedEmail || !trimmedName) {
      setError("Email and display name can't be empty.");
      return;
    }
    if (password && password.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }

    const data: { email?: string; password?: string; displayName?: string } = {};
    if (trimmedEmail !== user.email) data.email = trimmedEmail;
    if (trimmedName !== user.displayName) data.displayName = trimmedName;
    if (password) data.password = password;

    if (Object.keys(data).length === 0) {
      setError("Change at least one field before saving.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await api.admin.updateUserCredentials(user.id, data);
      onDone();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Failed to update credentials"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="card-duo w-full max-w-sm rounded-2xl bg-surface p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-ink">Change credentials -- {user.displayName}</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Setting a new password signs this user out of every device -- they'll need to log in again with it.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-muted">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg bg-surface-card px-3 py-2 text-sm text-ink ring-1 ring-border"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-muted">Display name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-lg bg-surface-card px-3 py-2 text-sm text-ink ring-1 ring-border"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-muted">New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to keep the current password"
              className="w-full rounded-lg bg-surface-card px-3 py-2 text-sm text-ink placeholder:text-gray-400 ring-1 ring-border"
            />
          </div>
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
            className="btn-duo flex-1 bg-brand py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {isSubmitting ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
