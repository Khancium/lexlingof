"use client";

import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, getErrorMessage } from "@/lib/api";

const schema = z
  .object({
    newPassword: z.string().min(8, "At least 8 characters"),
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });
type FormValues = z.infer<typeof schema>;

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    if (!token) {
      setServerError("This reset link is missing its token. Request a new one.");
      return;
    }
    setServerError(null);
    try {
      await api.auth.resetPassword(token, values.newPassword);
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch (err) {
      setServerError(getErrorMessage(err, "This reset link is invalid or has expired."));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
      <div className="card-duo w-full max-w-sm rounded-3xl bg-surface p-8 shadow-sm border border-border">
        <h1 className="mb-1 text-2xl font-bold text-ink">Choose a new password</h1>
        <p className="mb-6 text-sm text-ink-muted">This signs you out of every other device once it's saved.</p>

        {!token ? (
          <p className="text-sm text-red-600">This reset link is missing its token. Please request a new one.</p>
        ) : done ? (
          <p className="rounded-lg bg-brand-light/40 p-4 text-sm text-ink">Password updated. Taking you to log in...</p>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <input
                {...register("newPassword")}
                type="password"
                placeholder="New password"
                autoComplete="new-password"
                className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 outline-none ring-1 ring-border focus:ring-2 focus:ring-brand"
              />
              {errors.newPassword && <p className="mt-1 text-xs text-red-600">{errors.newPassword.message}</p>}
            </div>

            <div>
              <input
                {...register("confirmPassword")}
                type="password"
                placeholder="Confirm new password"
                autoComplete="new-password"
                className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 outline-none ring-1 ring-border focus:ring-2 focus:ring-brand"
              />
              {errors.confirmPassword && <p className="mt-1 text-xs text-red-600">{errors.confirmPassword.message}</p>}
            </div>

            {serverError && <p className="text-sm text-red-600">{serverError}</p>}

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-duo w-full bg-brand py-3 font-semibold text-ink-inverted transition hover:bg-brand-dark disabled:opacity-50"
            >
              {isSubmitting ? "Saving..." : "Save new password"}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-ink-muted">
          <Link href="/login" className="font-medium text-brand hover:underline">
            Back to log in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
