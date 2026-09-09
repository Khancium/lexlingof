"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/lib/store";

const LINKS = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/contributions", label: "Contributions" },
  { href: "/admin/concepts", label: "Concepts" },
  { href: "/admin/scenes", label: "Scenes" },
  { href: "/admin/sentences", label: "Sentences" },
];

const SUPER_ADMIN_LINKS = [
  { href: "/admin/gamification", label: "Gamification Config" },
  { href: "/admin/feature-flags", label: "Feature Flags" },
  { href: "/admin/logs", label: "Logs" },
];

export default function AdminNav() {
  const user = useAuthStore((state) => state.user);
  const pathname = usePathname();
  const isSuperAdmin = user?.role === "super_admin";

  const links = isSuperAdmin ? [...LINKS, ...SUPER_ADMIN_LINKS] : LINKS;

  return (
    <aside className="w-full shrink-0 border-b border-border bg-surface p-4 md:w-56 md:border-b-0 md:border-r">
      <Link href="/admin/dashboard" className="mb-3 block text-lg font-bold text-brand md:mb-6">
        Lexlingo Admin
      </Link>
      <nav className="flex gap-1 overflow-x-auto pb-1 md:block md:space-y-1 md:overflow-visible md:pb-0">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`block whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium transition md:whitespace-normal ${
                active ? "bg-brand text-ink-inverted" : "text-ink-muted hover:bg-surface-card hover:text-ink"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <Link href="/dashboard" className="mt-3 block text-xs text-ink-muted hover:text-ink md:mt-6">
        ← Back to app
      </Link>
    </aside>
  );
}
