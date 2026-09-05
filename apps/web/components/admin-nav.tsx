"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuthStore } from "@/lib/store";

const LINKS = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/contributions", label: "Contributions" },
  { href: "/admin/concepts", label: "Concepts" },
  { href: "/admin/scenes", label: "Scenes" },
  { href: "/admin/sentences", label: "Sentences" },
];

const SUPER_ADMIN_LINKS = [
  { href: "/admin/gamification", label: "Gamification Config" },
  { href: "/admin/feature-flags", label: "Feature Flags" },
];

export default function AdminNav() {
  const user = useAuthStore((state) => state.user);
  const pathname = usePathname();
  const isSuperAdmin = user?.role === "super_admin";

  const links = isSuperAdmin ? [...LINKS, ...SUPER_ADMIN_LINKS] : LINKS;

  return (
    <aside className="w-56 shrink-0 border-r border-border bg-surface p-4">
      <Link href="/admin/dashboard" className="mb-6 block text-lg font-bold text-brand">
        Lexlingo Admin
      </Link>
      <nav className="space-y-1">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`block rounded-full px-3 py-2 text-sm font-medium transition ${
                active ? "bg-brand text-ink-inverted" : "text-ink-muted hover:bg-surface-card hover:text-ink"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <Link href="/dashboard" className="mt-6 block text-xs text-ink-muted hover:text-ink">
        ← Back to app
      </Link>
    </aside>
  );
}
