import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { deleteSessionCookie, validateSessionToken } from "@/lib/auth/session";
import { resolveSessionRecovery } from "@/lib/auth/session-recovery";

/**
 * Recovery hop for browsers holding a ko_session cookie with no live DB row.
 * Server Components can't mutate cookies, so guards redirect here instead of
 * straight to /login — otherwise the proxy's presence-only check bounces the
 * dead cookie back to /dashboard forever (ERR_TOO_MANY_REDIRECTS).
 */
export async function GET(request: NextRequest) {
  const store = await cookies();
  const { clearCookie, redirectTo } = await resolveSessionRecovery(
    { validateSessionToken },
    {
      token: store.get(SESSION_COOKIE)?.value,
      next: request.nextUrl.searchParams.get("next"),
    },
  );
  if (clearCookie) await deleteSessionCookie();
  return NextResponse.redirect(new URL(redirectTo, request.nextUrl.origin));
}
