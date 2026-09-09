"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import Nav from "@/components/nav";

// The root layout's AuthProvider already blocks rendering (full-screen
// spinner) until the initial loadUser() call resolves, so by the time this
// layout runs, isLoading is already false -- this only needs to redirect
// when there's genuinely no user.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const router = useRouter();

  useEffect(() => {
    if (!user) {
      router.replace("/login");
    }
  }, [user, router]);

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-surface-muted">
      <Nav />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
