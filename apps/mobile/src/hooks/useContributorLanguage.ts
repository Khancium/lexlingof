import { useEffect, useState } from 'react';
import { api } from '../services/api.service';

// Every module submission requires a languageId (and optionally a
// dialectId) -- set once during Onboarding onto the user's profile. Shared
// across all four module screens rather than refetched ad hoc by each.
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
