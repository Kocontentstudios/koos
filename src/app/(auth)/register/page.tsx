"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { signInWithGoogle, signup } from "../actions";

const STRENGTH_COLORS = [
  "var(--error)",
  "#D4A954",
  "#85B7EB",
  "var(--success)",
];
const STRENGTH_LABELS = ["Weak", "Fair", "Good", "Strong"];

/** Mirrors checkStrength() in koos_complete/register.html — 0–4 score. */
function passwordScore(val: string): number {
  let score = 0;
  if (val.length >= 8) score++;
  if (/[A-Z]/.test(val)) score++;
  if (/[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;
  return score;
}

type RegisterState = { error?: string } | null;

export default function RegisterPage() {
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [password, setPassword] = useState("");
  const [googlePending, startGoogle] = useTransition();

  const score = passwordScore(password);
  const level = Math.min(score - 1, 3);

  // Framework-owned pending flag so the spinner reliably covers the full
  // sign-up round-trip.
  const [formState, formAction, formPending] = useActionState<
    RegisterState,
    FormData
  >(async (_prev, formData) => {
    const pw = formData.get("password") as string;
    if (pw.length < 6) {
      return { error: "Password must be at least 6 characters" };
    }
    const result = await signup(formData);
    return result ?? null;
  }, null);

  const anyPending = formPending || googlePending;
  const error = formState?.error ?? googleError;

  function handleGoogleSignIn() {
    setGoogleError(null);
    startGoogle(async () => {
      const result = await signInWithGoogle();
      if (result?.error) setGoogleError(result.error);
    });
  }

  return (
    <div className="font-brand relative min-h-screen flex items-center justify-center bg-background p-4 overflow-hidden">
      {/* Background orbs — mirrors koos_complete/register.html */}
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
        <div className="flex items-center justify-center gap-2.5 mb-8">
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
        </div>

        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-foreground leading-tight mb-1.5">
            Create your account
          </h1>
          <p className="text-[var(--text-secondary)] text-sm">
            Start creating content strategies with KO
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-[rgba(212,117,117,0.08)] border border-[rgba(212,117,117,0.2)] p-3 text-sm text-[var(--status-error-fg)]">
            {error}
          </div>
        )}

        <form action={formAction} className="flex flex-col gap-5">
          {/* Name Row */}
          <div className="flex gap-4">
            <div className="flex-1 flex flex-col gap-1.5">
              <label
                className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
                htmlFor="firstName"
              >
                First Name
              </label>
              <input
                className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-foreground w-full placeholder:text-[var(--text-muted)] focus:outline-none focus:border-primary focus:ring-1 focus:ring-[var(--accent-glow)] transition-colors"
                id="firstName"
                name="firstName"
                placeholder="John"
                required
                type="text"
              />
            </div>
            <div className="flex-1 flex flex-col gap-1.5">
              <label
                className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
                htmlFor="lastName"
              >
                Last Name
              </label>
              <input
                className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-foreground w-full placeholder:text-[var(--text-muted)] focus:outline-none focus:border-primary focus:ring-1 focus:ring-[var(--accent-glow)] transition-colors"
                id="lastName"
                name="lastName"
                placeholder="Doe"
                required
                type="text"
              />
            </div>
          </div>

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

          {/* Password */}
          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]"
              htmlFor="password"
            >
              Password
            </label>
            <div className="relative">
              <input
                className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl px-4 py-2.5 pr-10 text-sm text-foreground w-full placeholder:text-[var(--text-muted)] focus:outline-none focus:border-primary focus:ring-1 focus:ring-[var(--accent-glow)] transition-colors"
                id="password"
                name="password"
                placeholder="At least 6 characters"
                required
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                aria-label={showPw ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 px-3 flex items-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                onClick={() => setShowPw(!showPw)}
                type="button"
              >
                {showPw ? (
                  <EyeOff aria-hidden="true" className="w-4 h-4" />
                ) : (
                  <Eye aria-hidden="true" className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Password strength meter */}
            <div className="mt-1 flex gap-1.5">
              {["seg1", "seg2", "seg3", "seg4"].map((seg, i) => (
                <div
                  key={seg}
                  className="h-1 flex-1 rounded-full transition-colors"
                  style={{
                    background:
                      i < score ? STRENGTH_COLORS[level] : "var(--border)",
                  }}
                />
              ))}
            </div>
            <p
              className="text-[11px]"
              style={{
                color: score > 0 ? STRENGTH_COLORS[level] : "var(--text-muted)",
              }}
            >
              {score > 0 ? STRENGTH_LABELS[level] : "Password strength"}
            </p>
          </div>

          {/* Submit */}
          <button
            className={cn(
              "w-full bg-primary text-white rounded-xl text-sm font-semibold py-2.5 mt-1 flex justify-center items-center gap-2 h-10 transition-colors",
              anyPending
                ? "opacity-50 cursor-not-allowed"
                : "hover:bg-[var(--primary-hover)]",
            )}
            disabled={anyPending}
            type="submit"
          >
            {formPending ? (
              <>
                <Spinner />
                Creating account…
              </>
            ) : (
              "Create Account"
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-[var(--border)]" />
          <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider">
            or
          </span>
          <div className="flex-1 h-px bg-[var(--border)]" />
        </div>

        {/* Google Sign Up */}
        <button
          aria-label="Continue with Google"
          className={cn(
            "w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-xl text-sm font-semibold py-2.5 flex justify-center items-center gap-2.5 text-foreground h-10 transition-colors",
            anyPending
              ? "opacity-50 cursor-not-allowed"
              : "hover:bg-[var(--surface-1)] hover:border-[var(--border-hover)]",
          )}
          disabled={anyPending}
          onClick={handleGoogleSignIn}
          type="button"
        >
          {googlePending ? (
            <>
              <Spinner />
              Connecting…
            </>
          ) : (
            <>
              <svg
                aria-hidden="true"
                className="w-4 h-4 shrink-0"
                viewBox="0 0 24 24"
              >
                <title>Google</title>
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </>
          )}
        </button>

        {/* Login Link */}
        <div className="mt-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">
            Already have an account?{" "}
            <Link
              className="text-primary hover:text-[var(--primary-hover)] font-semibold transition-colors"
              href="/login"
            >
              Sign in.
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
