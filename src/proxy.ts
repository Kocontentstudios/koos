import { type NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";

/* Host-based routing: this single deployment answers two domains.
   - kocontentstudios.com      → marketing / landing page
   - app.kocontentstudios.com  → the KO-OS app (auth + dashboard + admin)
   Unrecognized hosts (localhost, *.vercel.app previews) are left alone so
   local dev and preview deploys serve the whole app on one origin. */
const ROOT_HOST = "kocontentstudios.com";
const APP_HOST = "app.kocontentstudios.com";

// Real URL paths that belong to the app. Route groups like (dashboard) are
// stripped from the URL, so these are the actual path prefixes.
const appPrefixes = [
  "/login",
  "/register",
  "/auth",
  "/dashboard",
  "/brand",
  "/calendar",
  "/design-request",
  "/settings",
  "/strategy",
  "/admin",
];
// Marketing pages that stay canonical on the root domain.
const marketingPrefixes = ["/privacy", "/terms"];

const protectedRoutes = [
  "/dashboard",
  "/brand",
  "/strategy",
  "/calendar",
  "/design-request",
  "/settings",
];
const authRoutes = ["/login", "/register"];

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Cheap cookie-presence gate. The session is *validated* (against the DB) in
// server layouts/pages via getAuthUser — proxy runs on the edge where the
// Postgres driver is unavailable, so it only checks the cookie exists.
export function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").split(":")[0];
  const { pathname, search } = request.nextUrl;

  // 1. Host split — only enforced on the two production hosts. Must run before
  // the auth gate so redirects land on the correct domain.
  if (host === ROOT_HOST && matchesPrefix(pathname, appPrefixes)) {
    return NextResponse.redirect(`https://${APP_HOST}${pathname}${search}`);
  }
  if (host === APP_HOST) {
    // Bare app root → into the app; the auth gate below bounces unauthenticated
    // visitors to /login.
    if (pathname === "/") {
      return NextResponse.redirect(`https://${APP_HOST}/dashboard`);
    }
    // Keep marketing pages canonical on the root domain.
    if (matchesPrefix(pathname, marketingPrefixes)) {
      return NextResponse.redirect(`https://${ROOT_HOST}${pathname}${search}`);
    }
  }

  // 2. Auth gating (applies on every host, including localhost).
  const hasSession = Boolean(request.cookies.get(SESSION_COOKIE)?.value);

  if (!hasSession && protectedRoutes.some((r) => pathname.startsWith(r))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (hasSession && authRoutes.some((r) => pathname.startsWith(r))) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
