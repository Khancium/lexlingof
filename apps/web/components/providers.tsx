"use client";

import { useEffect, type ReactNode } from "react";
import { useAuthStore } from "@/lib/store";

function LoadingSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-300 border-t-brand" />
    </div>
  );
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const isLoading = useAuthStore((state) => state.isLoading);
  const loadUser = useAuthStore((state) => state.loadUser);

  useEffect(() => {
    loadUser();
    // Runs once on mount -- loadUser is a stable Zustand action reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return <>{children}</>;
}
