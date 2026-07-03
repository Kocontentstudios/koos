import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/* Host-based routing for a single deployment served on two domains:
   - kocontentstudios.com      → marketing / landing page
   - app.kocontentstudios.com  → the KO-OS app (auth + dashboard + admin)

   Both hosts hit the same Vercel deployment, so without this guard the landing
   page would be reachable on the app subdomain and vice versa. Any host we don't
   recognize (localhost, Vercel preview URLs) is passed through untouched, so
   local development and preview deploys behave exactly as before. */

const ROOT_HOST = "kocontentstudios.com";
const APP_HOST = "app.kocontentstudios.com";

// URL path prefixes that belong to the app (only valid on the app subdomain).
// These are the real URLs — Next.js route groups like (dashboard) are stripped.
const APP_PREFIXES = [
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

// Marketing pages that belong on the root domain (besides "/").
const MARKETING_PREFIXES = ["/privacy", "/terms"];

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function middleware(req: NextRequest) {
  // Strip the port so localhost:3000 etc. never matches a production host.
  const host = (req.headers.get("host") ?? "").split(":")[0];
  const { pathname, search } = req.nextUrl;

  // Only enforce the split on the two production hosts. Everything else
  // (localhost, *.vercel.app previews) serves the whole app as-is.
  if (host !== ROOT_HOST && host !== APP_HOST) {
    return NextResponse.next();
  }

  // On the marketing domain, hand off any app route to the app subdomain.
  if (host === ROOT_HOST && matchesPrefix(pathname, APP_PREFIXES)) {
    return NextResponse.redirect(`https://${APP_HOST}${pathname}${search}`);
  }

  if (host === APP_HOST) {
    // Bare app root → into the app; the dashboard's own auth guard will bounce
    // unauthenticated visitors to /login.
    if (pathname === "/") {
      return NextResponse.redirect(`https://${APP_HOST}/dashboard`);
    }
    // Keep marketing pages canonical on the root domain.
    if (matchesPrefix(pathname, MARKETING_PREFIXES)) {
      return NextResponse.redirect(`https://${ROOT_HOST}${pathname}${search}`);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Run on page routes only — skip API routes (they're same-origin on whichever
  // host calls them), Next internals, and static files (anything with a dot).
  matcher: ["/((?!api/|_next/|.*\\..*).*)"],
};
