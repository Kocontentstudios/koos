/** Absolute app URL for links that leave the app (emails, OAuth redirects).
 *
 * Base resolution: NEXT_PUBLIC_APP_URL (canonical, set per Vercel environment)
 * → VERCEL_PROJECT_PRODUCTION_URL (auto-provided host, protocol-less) →
 * localhost. The localhost fallback is dev-only; hitting it in production
 * means misconfigured env, so it warns loudly instead of silently emitting
 * unreachable links.
 */
export function appUrl(path: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base = (
    configured ||
    (vercelHost ? `https://${vercelHost}` : "") ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
  if (!configured && !vercelHost && process.env.NODE_ENV === "production") {
    console.warn(
      "appUrl: NEXT_PUBLIC_APP_URL is not set — emitting localhost links. Set it in the deployment environment.",
    );
  }
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
