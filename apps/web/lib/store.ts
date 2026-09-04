import { create } from "zustand";
import axios from "axios";
import { api, type UserProfile } from "./api";

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
    set({ isLoading: true, error: null });
    try {
      const user = await api.users.getMe();
      set({ user, isLoading: false });
    } catch (err) {
      // A 401 here just means "not logged in" (no session to restore) --
      // that's an expected state on a public page, not an app error to
      // surface. Anything else (network failure, 500) is a real error.
      const isUnauthorized = axios.isAxiosError(err) && err.response?.status === 401;
      set({
        user: null,
        isLoading: false,
        error: isUnauthorized ? null : err instanceof Error ? err.message : "Failed to load user",
      });
    }
  },
}));
