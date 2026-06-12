'use client';

import { useEffect, useState } from 'react';
import { login, signInWithGoogle } from '../actions';
import { cn } from '@/lib/utils';

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Surface errors handed back by the OAuth callback (e.g. consent denied or a
  // misconfigured provider) via the `?error=` query param.
  useEffect(() => {
    const callbackError = new URLSearchParams(window.location.search).get(
      'error',
    );
    if (callbackError) {
      setError(callbackError);
    }
  }, []);

  async function handleSubmit(formData: FormData) {
    setError(null);
    setLoading(true);
    const result = await login(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setLoading(true);
    const result = await signInWithGoogle();
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex w-1/2 relative flex-col justify-between p-16 border-r border-outline-variant/20 overflow-hidden">
        {/* Background Image */}
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-background" />
          <div className="absolute top-1/4 right-1/4 w-96 h-96 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute bottom-1/4 left-1/4 w-64 h-64 rounded-full bg-secondary/5 blur-3xl" />
        </div>

        {/* Logo */}
        <div className="relative z-10">
          <span className="font-[family-name:var(--font-heading)] text-2xl font-bold text-primary">
            KO Platform
          </span>
        </div>

        {/* Tagline */}
        <div className="relative z-10 max-w-lg mt-auto">
          <h2 className="text-5xl md:text-7xl font-extrabold leading-[1.1] tracking-tight font-[family-name:var(--font-heading)] text-on-surface mb-6">
            Strategic.
            <br />
            Precision.
          </h2>
          <p className="text-lg text-on-surface-variant leading-relaxed">
            Access the unified production environment engineered for creative
            authority and structural clarity.
          </p>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-6 md:p-16 relative">
        {/* Mobile Logo */}
        <div className="absolute top-5 left-5 lg:hidden">
          <span className="font-[family-name:var(--font-heading)] text-2xl font-bold text-primary">
            KO
          </span>
        </div>

        <div className="w-full max-w-md rounded-lg border border-outline-variant/10 p-10 shadow-2xl bg-surface-container-low">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl md:text-[48px] font-bold leading-[1.2] font-[family-name:var(--font-heading)] text-on-surface mb-2">
              Welcome back
            </h1>
            <p className="text-base text-on-surface-variant">
              Log in to your KO Platform account.
            </p>
          </div>

          {error && (
            <div className="mb-6 rounded bg-error/10 border border-error/20 p-3 text-sm text-error">
              {error}
            </div>
          )}

          <form action={handleSubmit} className="flex flex-col gap-6">
            {/* Email */}
            <div className="flex flex-col gap-2">
              <label
                className="text-sm font-bold uppercase tracking-wider text-on-surface-variant"
                htmlFor="email"
              >
                Email
              </label>
              <input
                className="bg-surface border border-outline-variant/50 rounded px-6 py-3 text-base text-on-surface w-full placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                id="email"
                name="email"
                placeholder="name@company.com"
                required
                type="email"
              />
            </div>

            {/* Password */}
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-baseline">
                <label
                  className="text-sm font-bold uppercase tracking-wider text-on-surface-variant"
                  htmlFor="password"
                >
                  Password
                </label>
                <a
                  className="text-xs text-primary hover:text-secondary transition-colors"
                  href="#"
                >
                  Forgot password?
                </a>
              </div>
              <input
                className="bg-surface border border-outline-variant/50 rounded px-6 py-3 text-base text-on-surface w-full placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                id="password"
                name="password"
                placeholder="••••••••"
                required
                type="password"
              />
            </div>

            {/* Submit */}
            <button
              className={cn(
                'w-full bg-primary text-primary-foreground rounded text-sm font-bold uppercase tracking-wider py-3 mt-3 flex justify-center items-center h-12 transition-colors',
                loading
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:bg-primary/90',
              )}
              disabled={loading}
              type="submit"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-8">
            <div className="flex-1 h-px bg-outline-variant/30" />
            <span className="text-xs text-on-surface-variant uppercase tracking-wider">
              or continue with
            </span>
            <div className="flex-1 h-px bg-outline-variant/30" />
          </div>

          {/* Google Sign In */}
          <button
            className={cn(
              'w-full bg-surface border border-outline-variant/30 rounded text-sm font-bold uppercase tracking-wider py-3 flex justify-center items-center gap-3 text-on-surface transition-all h-12',
              loading
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-surface-container hover:border-outline-variant/60',
            )}
            disabled={loading}
            onClick={handleGoogleSignIn}
            type="button"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
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
            Sign in with Google
          </button>

          {/* Sign Up Link */}
          <div className="mt-10 text-center">
            <p className="text-base text-on-surface-variant">
              Don&apos;t have an account?{' '}
              <a
                className="text-sm font-bold text-primary hover:text-secondary hover:underline transition-colors ml-1"
                href="/register"
              >
                Sign up
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
