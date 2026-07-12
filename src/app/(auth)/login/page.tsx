"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  useActionState,
  useEffect,
  useState,
  useTransition,
} from "react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { login, signInWithGoogle } from "../actions";

type LoginState = { error?: string } | null;

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "";
  const invitedEmail = searchParams.get("email") ?? "";
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [googlePending, startGoogle] = useTransition();

  // useActionState owns the submit pending flag, so the spinner is guaranteed
  // to show for the whole server round-trip (unlike a manual useState flag set
  // inside a form-action transition, which can be batched away).
  const [formState, formAction, formPending] = useActionState<
    LoginState,
    FormData
  >(async (_prev, formData) => {
    const result = await login(formData);
    return result ?? null;
  }, null);

  const anyPending = formPending || googlePending;
  const error = formState?.error ?? callbackError;

  // Surface errors handed back by the OAuth callback (e.g. consent denied or a
  // misconfigured provider) via the `?error=` query param.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cb = params.get("error");
    if (cb) setCallbackError(cb);
    if (params.get("reset") === "1") setResetDone(true);
  }, []);

  function handleGoogleSignIn() {
    setCallbackError(null);
    startGoogle(async () => {
      const result = await signInWithGoogle();
      if (result?.error) setCallbackError(result.error);
    });
  }

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
            Welcome back
          </h1>
          <p className="text-[var(--text-secondary)] text-sm">
            Sign in to your KO OS account
          </p>
        </div>

        {resetDone && !error && (
          <div className="mb-6 rounded-lg bg-[rgba(52,199,89,0.08)] border border-[rgba(52,199,89,0.2)] p-3 text-sm text-[var(--text-secondary)]">
            Password updated. Sign in with your new password.
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-lg bg-[rgba(212,117,117,0.08)] border border-[rgba(212,117,117,0.2)] p-3 text-sm text-[var(--status-error-fg)]">
            {error}
          </div>
        )}

        <form action={formAction} className="flex flex-col gap-5">
          {next ? <input type="hidden" name="next" value={next} /> : null}
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
              defaultValue={invitedEmail}
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
                placeholder="••••••••"
                required
                type={showPw ? "text" : "password"}
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
            <div className="flex justify-end mt-1">
              <Link
                className="text-xs text-primary hover:text-[var(--primary-hover)] font-semibold transition-colors"
                href="/forgot-password"
              >
                Forgot password?
              </Link>
            </div>
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
                Signing in…
              </>
            ) : (
              "Sign In"
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

        {/* Google Sign In */}
        <button
          aria-label="Sign in with Google"
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

        {/* Register Link */}
        <div className="mt-8 text-center">
          <p className="text-sm text-[var(--text-secondary)]">
            Need an account?{" "}
            <Link
              className="text-primary hover:text-[var(--primary-hover)] font-semibold transition-colors"
              href={`/register${next ? `?next=${encodeURIComponent(next)}${invitedEmail ? `&email=${encodeURIComponent(invitedEmail)}` : ""}` : ""}`}
            >
              Create one.
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
