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

  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  useEffect(() => {
    if (!user) {
      router.replace("/login");
    } else if (!isAdmin) {
      router.replace("/dashboard");
    }
  }, [user, isAdmin, router]);

  if (!user || !isAdmin) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-slate-950">
      <AdminNav />
      <main className="flex-1 overflow-x-auto p-8">{children}</main>
    </div>
  );
}
