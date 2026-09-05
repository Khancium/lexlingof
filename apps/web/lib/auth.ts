"use client";

import { useAuthStore } from "./store";
import { api } from "./api";

export function useAuth() {
  const user = useAuthStore((state) => state.user);
  const isLoading = useAuthStore((state) => state.isLoading);
  const setUser = useAuthStore((state) => state.setUser);
  const clearUser = useAuthStore((state) => state.logout);

  async function login(email: string, password: string) {
    await api.auth.login(email, password);
    const me = await api.users.getMe();
    setUser(me);
  }

  async function register(email: string, password: string) {
    await api.auth.register(email, password);
    const me = await api.users.getMe();
    setUser(me);
  }

  async function logout() {
    await api.auth.logout();
    clearUser();
  }

  return { user, isLoading, login, logout, register };
}
