"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { canReview } from "@/lib/level";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/contribute/concept", label: "Record Word" },
  { href: "/contribute/audio", label: "Upload Audio" },
  { href: "/contribute/translate", label: "Translate" },
  { href: "/contribute/scene", label: "Describe Scene" },
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

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  const links = canReview(user?.level) ? [...LINKS, { href: "/review", label: "Review" }] : LINKS;

  return (
    <nav className="border-b border-slate-800 bg-slate-900">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/dashboard" className="text-lg font-bold text-blue-500">
          Lexlingo
        </Link>

        <div className="flex flex-wrap items-center gap-1">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                  active ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-slate-400 sm:inline">{user?.displayName}</span>
          <button
            onClick={handleLogout}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Sign Out
          </button>
        </div>
      </div>
    </nav>
  );
}
