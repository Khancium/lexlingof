"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import { loadLevelThresholds } from "@/lib/level";
import Nav from "@/components/nav";

// Registration only ever asked for email/password -- onboarding (the real
// name, demographics, primary language) was a separate step a user could
// always abandon (browser Back, closing the tab) and still end up fully
// inside the app with none of it ever submitted. Accounts created before
// this gate existed are grandfathered in rather than retroactively locked
// out of an app they were already using.
const ONBOARDING_REQUIRED_SINCE = new Date("2026-11-25T10:41:20.000Z");

// The root layout's AuthProvider already blocks rendering (full-screen
// spinner) until the initial loadUser() call resolves, so by the time this
// layout runs, isLoading is already false -- this only needs to redirect
// when there's genuinely no user.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const router = useRouter();

  const needsOnboarding =
    !!user && !user.language && new Date(user.createdAt) >= ONBOARDING_REQUIRED_SINCE;

  useEffect(() => {
    if (!user) {
      router.replace("/login");
    } else if (needsOnboarding) {
      router.replace("/onboarding");
    }
  }, [user, needsOnboarding, router]);

  useEffect(() => {
    loadLevelThresholds();
  }, []);

  if (!user || needsOnboarding) {
    return null;
  }

  return (
    <div className="min-h-screen bg-surface-muted">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
