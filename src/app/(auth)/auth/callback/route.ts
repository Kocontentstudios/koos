import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ensureUser } from '@/lib/auth/sync-user';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // Only allow same-origin relative redirects to avoid open-redirect abuse.
  const nextParam = searchParams.get('next') ?? '/dashboard';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//')
    ? nextParam
    : '/dashboard';

  // The OAuth provider (or Supabase) can return an error directly — e.g. the
  // user denied consent, or the provider is misconfigured.
  const providerError =
    searchParams.get('error_description') ?? searchParams.get('error');

  const failureRedirect = (message: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`);

  if (providerError) {
    return failureRedirect(providerError);
  }

  if (!code) {
    return failureRedirect('No authorization code returned from provider.');
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return failureRedirect(error.message);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await ensureUser(user);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
