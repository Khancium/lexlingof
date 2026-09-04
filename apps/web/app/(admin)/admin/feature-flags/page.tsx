"use client";

import { useEffect, useState } from "react";
import { useAuthStore } from "@/lib/store";
import { api, type FeatureFlag } from "@/lib/api";

export default function FeatureFlagsPage() {
  const user = useAuthStore((state) => state.user);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role !== "super_admin") return;
    api.superadmin.getFeatureFlags().then((res) => {
      setFlags(res);
      setLoading(false);
    });
  }, [user]);

  if (user?.role !== "super_admin") {
    return <p className="text-red-400">Super-admin access required.</p>;
  }

  async function toggle(flag: FeatureFlag) {
    setTogglingKey(flag.flagKey);
    try {
      const updated = await api.superadmin.updateFeatureFlag(flag.flagKey, !flag.isEnabled);
      setFlags((prev) => prev.map((f) => (f.flagKey === flag.flagKey ? updated : f)));
    } finally {
      setTogglingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Feature Flags</h1>

      {loading ? (
        <p className="text-slate-400">Loading...</p>
      ) : flags.length === 0 ? (
        <p className="text-slate-400">No feature flags configured.</p>
      ) : (
        <div className="space-y-3">
          {flags.map((flag) => (
            <div key={flag.flagKey} className="flex items-center justify-between rounded-xl bg-slate-800 p-4">
              <div>
                <p className="font-mono text-sm text-white">{flag.flagKey}</p>
                <p className="text-xs text-slate-400">{flag.description}</p>
              </div>
              <button
                onClick={() => toggle(flag)}
                disabled={togglingKey === flag.flagKey}
                className={`relative h-7 w-12 rounded-full transition ${flag.isEnabled ? "bg-emerald-600" : "bg-slate-600"}`}
                aria-label={`Toggle ${flag.flagKey}`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-transform ${
                    flag.isEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
