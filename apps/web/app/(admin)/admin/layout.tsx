"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import AdminNav from "@/components/admin-nav";

// The root layout's AuthProvider already blocks rendering until the initial
// loadUser() resolves, so by the time this runs, isLoading is already
// false -- this only needs to check the role.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const router = useRouter();

  // Volunteers reach /admin/* too (Concepts/Scenes/Sentences only -- the nav
  // itself hides everything else from them), so the guard admits their role
  // alongside admin/super_admin rather than gating on those two alone.
  const canAccessAdmin = user?.role === "admin" || user?.role === "super_admin" || user?.role === "volunteer";

  useEffect(() => {
    if (!user) {
      router.replace("/login");
    } else if (!canAccessAdmin) {
      router.replace("/dashboard");
    }
  }, [user, canAccessAdmin, router]);

  if (!user || !canAccessAdmin) {
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface-muted md:flex-row">
      <AdminNav />
      <main className="flex-1 overflow-x-auto p-4 sm:p-8">{children}</main>
    </div>
  );
}
