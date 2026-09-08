"use client";

import { useAuthStore } from "./store";

// Every module submission requires a languageId (and optionally a
// dialectId) -- set on the user's profile. providers.tsx already blocks
// rendering until useAuthStore's loadUser() resolves, so the profile
// (language/dialect included) is guaranteed to be in the store by the time
// any page using this hook mounts -- no need for this hook to issue its own
// GET /users/me and re-fetch data the app already has.
export function useContributorLanguage() {
  const user = useAuthStore((state) => state.user);
  const isLoading = useAuthStore((state) => state.isLoading);

  return {
    languageId: user?.language?.id ?? null,
    dialectId: user?.dialect?.id ?? null,
    isLoading,
  };
}
