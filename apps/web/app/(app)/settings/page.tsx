"use client";

import { useState } from "react";
import { useAuthStore } from "@/lib/store";
import { api, getErrorMessage } from "@/lib/api";


function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      aria-pressed={checked}
      className={`relative h-7 w-12 flex-shrink-0 rounded-full transition disabled:opacity-50 ${checked ? "bg-emerald-600" : "bg-gray-300"}`}
    >
      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

export default function SettingsPage() {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);

  const [savingField, setSavingField] = useState<"autoLoadNext" | "pushNotificationsEnabled" | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  async function toggleField(field: "autoLoadNext" | "pushNotificationsEnabled") {
    if (!user) return;
    const nextValue = !user[field];
    setSavingField(field);
    setToggleError(null);
    try {
      const updated = await api.users.updateMe({ [field]: nextValue });
      setUser(updated);
    } catch (err) {
      setToggleError(getErrorMessage(err, "Failed to save setting"));
    } finally {
      setSavingField(null);
    }
  }

  if (!user) {
    return <p className="text-ink-muted">Loading...</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-ink">Settings</h1>

      <div className="card-duo space-y-5 rounded-2xl bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-bold text-ink">Contribution Flow</h2>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-ink">Auto-load next item</p>
            <p className="text-sm text-ink-muted">
              Automatically move to the next sentence, object, or scene right after you submit. Turn this off to review
              each submission and click Next yourself.
            </p>
          </div>
          <Toggle
            checked={user.autoLoadNext}
            onChange={() => toggleField("autoLoadNext")}
            disabled={savingField === "autoLoadNext"}
          />
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border pt-5">
          <div>
            <p className="font-medium text-ink">Push notifications</p>
            <p className="text-sm text-ink-muted">
              Get notified when a contribution is verified, you earn a badge, or level up. Applies to the mobile app and
              any device you've signed into.
            </p>
          </div>
          <Toggle
            checked={user.pushNotificationsEnabled}
            onChange={() => toggleField("pushNotificationsEnabled")}
            disabled={savingField === "pushNotificationsEnabled"}
          />
        </div>

        {toggleError ? <p className="text-sm text-red-600">{toggleError}</p> : null}
      </div>
    </div>
  );
}
