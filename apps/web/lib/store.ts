import { create } from "zustand";
import axios from "axios";
import { api, clearSessionHint, ensureAccessToken, hasStoredRefreshToken, type UserProfile } from "./api";

type AuthState = {
  user: UserProfile | null;
  isLoading: boolean;
  error: string | null;
  setUser: (user: UserProfile | null) => void;
  logout: () => void;
  loadUser: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  // Starts true: components/providers.tsx holds a loading spinner until the
  // initial loadUser() call (checking for a restorable session) resolves.
  isLoading: true,
  error: null,

  setUser: (user) => set({ user }),

  logout: () => set({ user: null, error: null }),

  loadUser: async () => {
    // No refresh token in sessionStorage means there's plainly no session to
    // restore -- skip the GET /users/me round trip (which would just 401)
    // entirely, rather than firing it unconditionally on every app boot.
    if (!hasStoredRefreshToken()) {
      set({ user: null, isLoading: false, error: null });
      return;
    }
    set({ isLoading: true, error: null });
    try {
      // Mint the access token up front rather than letting GET /users/me 401
      // and be retried by the interceptor -- that path costs an extra full
      // round trip on every page load, all of it spent behind the blocking
      // spinner in components/providers.tsx.
      const token = await ensureAccessToken();
      if (!token) {
        set({ user: null, isLoading: false, error: null });
        return;
      }
      const user = await api.users.getMe();
      set({ user, isLoading: false });
    } catch (err) {
      // A 401 here just means "not logged in" (no session to restore) --
      // that's an expected state on a public page, not an app error to
      // surface. Anything else (network failure, 500) is a real error.
      const isUnauthorized = axios.isAxiosError(err) && err.response?.status === 401;
      // The refresh was definitively rejected, so the session hint is stale --
      // clear it or every later boot re-fires a refresh that can only 401.
      // Network errors / timeouts / 5xx are deliberately NOT cleared: the
      // session may still be perfectly valid and restorable on the next boot.
      if (isUnauthorized) clearSessionHint();
      set({
        user: null,
        isLoading: false,
        error: isUnauthorized ? null : err instanceof Error ? err.message : "Failed to load user",
      });
    }
  },
}));
