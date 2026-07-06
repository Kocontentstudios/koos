"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { requestPasswordReset } from "../actions";

type ForgotPasswordState = { error?: string; success?: string } | null;

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState<
    ForgotPasswordState,
    FormData
  >(
    async (_prev, formData) => (await requestPasswordReset(formData)) ?? null,
    null,
  );

  return (
    <div className="font-brand relative min-h-screen flex items-center justify-center bg-background p-4 overflow-hidden">
      {/* Background orbs — mirrors koos_complete/login.html */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed top-[-20%] left-[-10%] w-150 h-150 rounded-full bg-primary blur-[100px] opacity-[0.06]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed bottom-[-20%] right-[-10%] w-125 h-125 rounded-full bg-[#A855F7] blur-[100px] opacity-[0.06]"
      />

      <div className="relative z-[2] w-full max-w-[420px] mx-auto bg-surface-1 rounded-2xl border border-[var(--border)] p-10 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
        {/* KO OS Wordmark */}
        <Link
          href="/"
          aria-label="KO OS — back to home"
          className="flex items-center justify-center gap-2.5 mb-8"
        >
          <div
            aria-hidden="true"
            className="w-9 h-9 rounded-[10px] bg-primary flex items-center justify-center"
          >
            <span className="text-white text-sm font-extrabold leading-none">
              KO
            </span>
          </div>
          <span className="text-lg font-bold text-foreground tracking-tight">
            KO OS
          </span>
        </Link>

        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-foreground leading-tight mb-1.5">
            Reset your password
          </h1>
          <p className="text-[var(--text-secondary)] text-sm">
            Enter your email and we&apos;ll send you a reset link.
          </p>
        </div>

        {state?.error && (
          <div className="mb-6 rounded-lg bg-[rgba(212,117,117,0.08)] border border-[rgba(212,117,117,0.2)] p-3 text-sm text-[var(--status-error-fg)]">
            {state.error}
          </div>
        )}

        {state?.success && (
          <div className="mb-6 rounded-lg bg-[rgba(52,199,89,0.08)] border border-[rgba(52,199,89,0.2)] p-3 text-sm text-[var(--text-secondary)]">
            {state.success}
          </div>
        )}

        {!state?.success && (
          <form action={formAction} className="flex flex-col gap-5">
            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label
                className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
                htmlFor="email"
              >
                Email
              </label>
              <input
                className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-foreground w-full placeholder:text-[var(--text-muted)] focus:outline-none focus:border-primary focus:ring-1 focus:ring-[var(--accent-glow)] transition-colors"
                id="email"
                name="email"
                placeholder="name@company.com"
                required
                type="email"
              />
            </div>

            {/* Submit */}
            <button
              className={cn(
                "w-full bg-primary text-white rounded-xl text-sm font-semibold py-2.5 mt-1 flex justify-center items-center gap-2 h-10 transition-colors",
                pending
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:bg-[var(--primary-hover)]",
              )}
              disabled={pending}
              type="submit"
            >
              {pending ? (
                <>
                  <Spinner />
                  Sending…
                </>
              ) : (
                "Send Reset Link"
              )}
            </button>
          </form>
        )}

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">
            <Link
              className="text-primary hover:text-[var(--primary-hover)] font-semibold transition-colors"
              href="/login"
            >
              Back to sign in.
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
