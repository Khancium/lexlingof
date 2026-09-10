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

  const [suggestion, setSuggestion] = useState("");
  const [isSubmittingSuggestion, setIsSubmittingSuggestion] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [suggestionSent, setSuggestionSent] = useState(false);

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

  async function submitSuggestion() {
    if (suggestion.trim().length === 0) return;
    setIsSubmittingSuggestion(true);
    setSuggestionError(null);
    setSuggestionSent(false);
    try {
      await api.users.submitSuggestion(suggestion.trim());
      setSuggestion("");
      setSuggestionSent(true);
    } catch (err) {
      setSuggestionError(getErrorMessage(err, "Failed to send suggestion"));
    } finally {
      setIsSubmittingSuggestion(false);
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

      <div className="card-duo space-y-3 rounded-2xl bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-bold text-ink">Suggestions &amp; Feedback</h2>
        <p className="text-sm text-ink-muted">
          Spotted a bug, or have an idea to make Lexlingo better? Send it straight to the team.
        </p>
        <textarea
          value={suggestion}
          onChange={(e) => {
            setSuggestion(e.target.value);
            setSuggestionSent(false);
          }}
          placeholder="Tell us what's on your mind..."
          rows={4}
          className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 ring-1 ring-border focus:ring-2 focus:ring-brand"
        />
        {suggestionError ? <p className="text-sm text-red-600">{suggestionError}</p> : null}
        {suggestionSent ? <p className="text-sm text-emerald-600">Thanks! Your feedback has been sent.</p> : null}
        <button
          onClick={submitSuggestion}
          disabled={isSubmittingSuggestion || suggestion.trim().length === 0}
          className="btn-duo bg-brand px-5 py-2.5 font-semibold text-ink-inverted hover:bg-brand-dark disabled:opacity-50"
        >
          {isSubmittingSuggestion ? "Sending..." : "Send Feedback"}
        </button>
      </div>
    </div>
  );
}
