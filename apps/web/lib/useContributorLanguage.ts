"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

// Every module submission requires a languageId (and optionally a
// dialectId) -- set on the user's profile. Shared across all four
// contribute pages rather than refetched by each independently.
export function useContributorLanguage() {
  const [languageId, setLanguageId] = useState<string | null>(null);
  const [dialectId, setDialectId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.users
      .getMe()
      .then((me) => {
        if (cancelled) return;
        setLanguageId(me.language?.id ?? null);
        setDialectId(me.dialect?.id ?? null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { languageId, dialectId, isLoading };
}
