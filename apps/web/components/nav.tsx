"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { canReview } from "@/lib/level";
import { ConfirmDialog } from "@/components/confirm-dialog";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/contribute", label: "Contribute" },
  { href: "/contributions", label: "My Contributions" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/corpus", label: "Corpus" },
  { href: "/profile", label: "Profile" },
];

export default function Nav() {
  const user = useAuthStore((state) => state.user);
  const { logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  // Collapse the mobile dropdown whenever the route changes, so it doesn't
  // stay open over the newly-navigated-to page.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  async function confirmLogout() {
    setConfirmingLogout(false);
    await logout();
    router.push("/login");
  }

  let links = canReview(user?.level) ? [...LINKS, { href: "/review", label: "Review" }] : LINKS;
  if (user?.role === "admin" || user?.role === "super_admin") {
    links = [...links, { href: "/admin/dashboard", label: "Admin" }];
  }

  function isActive(href: string) {
    return href === "/admin/dashboard"
      ? pathname?.startsWith("/admin")
      : pathname === href || pathname?.startsWith(`${href}/`);
  }

  return (
    <nav className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link href="/dashboard" className="text-lg font-bold text-brand">
          Lexlingo
        </Link>

        {/* Full link row -- desktop/tablet only. Below md this list would wrap
           into a cramped multi-row mess between the logo and sign-out button,
           so it's replaced entirely by the hamburger dropdown below. */}
        <div className="hidden flex-wrap items-center gap-1 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-full px-3 py-2 text-sm font-medium transition ${
                isActive(link.href) ? "bg-brand text-ink-inverted" : "text-ink-muted hover:bg-surface-card hover:text-ink"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <span className="text-sm text-ink-muted">{user?.displayName}</span>
          <button
            onClick={() => setConfirmingLogout(true)}
            className="rounded-full bg-surface-card px-3 py-2 text-sm font-medium text-ink hover:bg-border"
          >
            Sign Out
          </button>
        </div>

        <button
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-label="Toggle menu"
          aria-expanded={mobileOpen}
          className="rounded-lg p-2 text-xl leading-none text-ink hover:bg-surface-card md:hidden"
        >
          {mobileOpen ? "✕" : "☰"}
        </button>
      </div>

      {mobileOpen ? (
        <div className="flex flex-col gap-1 border-t border-border px-4 py-3 md:hidden">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive(link.href) ? "bg-brand text-ink-inverted" : "text-ink-muted hover:bg-surface-card hover:text-ink"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <div className="mt-2 flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm text-ink-muted">{user?.displayName}</span>
            <button
              onClick={() => setConfirmingLogout(true)}
              className="rounded-full bg-surface-card px-3 py-2 text-sm font-medium text-ink hover:bg-border"
            >
              Sign Out
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmingLogout}
        title="Sign out of Lexlingo?"
        message="You'll need to sign back in to continue contributing."
        confirmLabel="Sign Out"
        danger
        onConfirm={confirmLogout}
        onCancel={() => setConfirmingLogout(false)}
      />
    </nav>
  );
}
