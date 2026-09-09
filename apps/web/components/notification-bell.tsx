"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type NotificationItem } from "@/lib/api";

const POLL_INTERVAL_MS = 30000;

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function iconFor(notificationType: string): string {
  if (notificationType === "SUBMISSION_FAILED") return "⚠️";
  if (notificationType === "LEVEL_UP") return "🎉";
  if (notificationType.includes("BADGE")) return "🏅";
  if (notificationType.includes("VERIFIED")) return "✅";
  return "🔔";
}

export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  function load() {
    setLoading(true);
    api.notifications
      .getAll({ limit: 20 })
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const unreadCount = items.filter((n) => !n.readAt).length;

  async function markRead(item: NotificationItem) {
    if (item.readAt) return;
    setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n)));
    try {
      await api.notifications.markRead(item.id);
    } catch {
      // Best-effort -- a failed read-receipt isn't worth surfacing an error for.
    }
  }

  function handleView(item: NotificationItem) {
    markRead(item);
    setOpen(false);
    router.push("/contributions");
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative rounded-full p-2 text-ink hover:bg-surface-card"
      >
        <BellIcon />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-2xl bg-surface shadow-lg ring-1 ring-border"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="text-sm font-bold text-ink">Notifications</p>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <p className="px-4 py-6 text-center text-sm text-ink-muted">Loading...</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-ink-muted">No notifications yet.</p>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  onClick={() => markRead(item)}
                  className={`cursor-pointer border-b border-border px-4 py-3 last:border-0 hover:bg-surface-card ${
                    item.readAt ? "" : "bg-brand-light/30"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-lg leading-none">{iconFor(item.notificationType)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-ink">{item.title}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">{item.body}</p>
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-[11px] text-ink-muted">{timeAgo(item.createdAt)}</span>
                        {item.notificationType === "SUBMISSION_FAILED" ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleView(item);
                            }}
                            className="rounded-full bg-red-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-red-500"
                          >
                            View
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="border-t border-border px-4 py-2 text-center">
            <Link href="/contributions" onClick={() => setOpen(false)} className="text-xs font-semibold text-brand hover:underline">
              View My Contributions
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
