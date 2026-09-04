import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, setAccessToken } from '../services/api.service';

const REFRESH_TOKEN_KEY = 'lexlingo_refresh_token';
const DEVICE_TOKEN_KEY = 'lexlingo_device_token';

export type ContributorLevel = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  level: ContributorLevel;
  totalPoints: number;
  verifiedContributions: number;
  currentStreak: number;
};

type AuthState = {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  // True only right after a successful register() -- distinguishes a fresh
  // sign-up from a returning login so RootNavigator can route to Onboarding
  // exactly once, without Onboarding needing to live inside AuthStack (which
  // would be unreachable: isAuthenticated flips true the same tick register()
  // resolves, so RootNavigator swaps away from AuthStack immediately).
  justRegistered: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  updateUser: (partial: Partial<AuthUser>) => void;
  clearJustRegistered: () => void;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong';
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  // Starts true: RootNavigator holds the loading screen until the initial
  // loadUser() call (checking for a stored session) resolves.
  isLoading: true,
  isAuthenticated: false,
  error: null,
  justRegistered: false,

  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const { accessToken, refreshToken } = await api.auth.login(email, password);
      await AsyncStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      setAccessToken(accessToken);

      const user = await api.users.getMe();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch (err) {
      set({ error: errorMessage(err), isLoading: false });
      throw err;
    }
  },

  register: async (email, password, displayName) => {
    set({ isLoading: true, error: null });
    try {
      const { accessToken, refreshToken } = await api.auth.register(email, password, displayName);
      await AsyncStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      setAccessToken(accessToken);

      const user = await api.users.getMe();
      set({ user, isAuthenticated: true, isLoading: false, justRegistered: true });
    } catch (err) {
      set({ error: errorMessage(err), isLoading: false });
      throw err;
    }
  },

  logout: async () => {
    const refreshToken = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
    const deviceToken = await AsyncStorage.getItem(DEVICE_TOKEN_KEY);

    if (refreshToken) {
      try {
        await api.auth.logout(refreshToken);
      } catch {
        // Best-effort: local state is cleared below regardless.
      }
    }

    if (deviceToken) {
      try {
        await api.devices.unregister(deviceToken);
      } catch {
        // Best-effort.
      }
    }

    await AsyncStorage.multiRemove([REFRESH_TOKEN_KEY, DEVICE_TOKEN_KEY]);
    setAccessToken(null);
    set({ user: null, isAuthenticated: false, justRegistered: false });
  },

  loadUser: async () => {
    const refreshToken = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      set({ isLoading: false });
      return;
    }

    try {
      const { accessToken, refreshToken: newRefreshToken } = await api.auth.refreshToken(refreshToken);
      await AsyncStorage.setItem(REFRESH_TOKEN_KEY, newRefreshToken);
      setAccessToken(accessToken);

      const user = await api.users.getMe();
      set({ user, isAuthenticated: true, isLoading: false });
    } catch {
      await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
      setAccessToken(null);
      set({ isAuthenticated: false, isLoading: false });
    }
  },

  updateUser: (partial) => {
    const current = get().user;
    if (!current) {
      return;
    }
    set({ user: { ...current, ...partial } });
  },

  clearJustRegistered: () => set({ justRegistered: false }),
}));
