"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { api, getErrorMessage } from "@/lib/api";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
});
type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [serverError, setServerError] = useState<string | null>(null);
  // The backend always responds the same way whether or not the email
  // matches an account -- this page mirrors that by showing one generic
  // confirmation regardless of outcome, rather than a per-branch message
  // that would let someone probe which emails are registered.
  const [submitted, setSubmitted] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      await api.auth.forgotPassword(values.email);
      setSubmitted(true);
    } catch (err) {
      setServerError(getErrorMessage(err, "Something went wrong. Please try again."));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted px-4">
      <div className="card-duo w-full max-w-sm rounded-3xl bg-surface p-8 shadow-sm border border-border">
        <h1 className="mb-1 text-2xl font-bold text-ink">Forgot your password?</h1>
        <p className="mb-6 text-sm text-ink-muted">Enter your account email and we'll send you a link to reset it.</p>

        {submitted ? (
          <p className="rounded-lg bg-brand-light/40 p-4 text-sm text-ink">
            If an account exists for that email, a reset link is on its way. Check your inbox (and spam folder).
          </p>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <input
                {...register("email")}
                type="email"
                placeholder="Email"
                autoComplete="email"
                className="w-full rounded-lg bg-surface-card px-4 py-3 text-ink placeholder:text-gray-400 outline-none ring-1 ring-border focus:ring-2 focus:ring-brand"
              />
              {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
            </div>

            {serverError && <p className="text-sm text-red-600">{serverError}</p>}

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-duo w-full bg-brand py-3 font-semibold text-ink-inverted transition hover:bg-brand-dark disabled:opacity-50"
            >
              {isSubmitting ? "Sending..." : "Send reset link"}
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
