import type { MailEnv } from "@/lib/email";

/** Absolute app URL for links that leave the app: emails, and the OAuth
 *  redirect_uri.
 *
 * NEXT_PUBLIC_APP_URL wins wherever it is usable. It is not second-guessed
 * against the deployment's own host, even though a project-wide value bakes
 * the production URL into a staging build: Google matches redirect_uri
 * EXACTLY, so substituting the branch host here turns "Continue with Google"
 * into redirect_uri_mismatch on every preview. A wrong host is a
 * configuration fault that only configuration can fix — `linkHostMismatch`
 * below detects it and the admin Email panel reports it, rather than this
 * function silently choosing a different host for one caller's benefit and
 * breaking another's.
 */
/* The WHATWG URL parser STRIPS embedded tabs, newlines and other C0 controls,
   so "https://koos.app\nx" silently parses to the host "koos.appx" with no
   error anywhere. A multi-line paste into the Vercel dashboard is exactly how
   that happens, so the value is rejected before it reaches the parser. */
function hasControlOrSpace(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

function usableUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (hasControlOrSpace(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    // A query, a fragment or a path would be concatenated onto the route and
    // produce a dead link — "https://x.com?a=1" + "/invite/tok".
    if (parsed.search || parsed.hash) return null;
    if (parsed.pathname !== "/") return null;
    // Port 0 parses but is unroutable, so the link would be dead.
    if (parsed.port === "0") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Hosts Vercel guarantees resolve to THIS deployment. Empty off-platform. */
export function deploymentHosts(env: MailEnv = process.env): string[] {
  return [env.VERCEL_BRANCH_URL, env.VERCEL_URL]
    .map((host) =>
      host
        ?.trim()
        .replace(/^https?:\/\//, "")
        .toLowerCase(),
    )
    .filter((host): host is string => Boolean(host));
}

export function appUrlBase(env: MailEnv = process.env): string {
  /* Vercel sets VERCEL_PROJECT_PRODUCTION_URL on previews too, so preferring
     it unconditionally MANUFACTURES the wrong-host bug as the default for any
     preview without NEXT_PUBLIC_APP_URL — while a host that certainly serves
     this deployment sits unused. Detection would catch that; not creating it
     is better. An explicit NEXT_PUBLIC_APP_URL still wins either way, so
     nothing is second-guessed. */
  const productionHost =
    env.VERCEL_ENV === undefined || env.VERCEL_ENV === "production"
      ? env.VERCEL_PROJECT_PRODUCTION_URL?.trim().replace(/^https?:\/\//, "")
      : undefined;
  const base =
    usableUrl(env.NEXT_PUBLIC_APP_URL) ||
    (productionHost ? `https://${productionHost}` : "") ||
    // `vercel dev` sets VERCEL_URL to a bare localhost:3000, which must not be
    // given an https:// scheme.
    (deploymentHosts(env)[0] && env.VERCEL_ENV !== "development"
      ? `https://${deploymentHosts(env)[0]}`
      : "") ||
    "http://localhost:3000";
  return base.replace(/\/$/, "");
}

/** True when NEXT_PUBLIC_APP_URL is set to something that cannot produce a
    working absolute link — a bare hostname, a non-http scheme, or a value
    carrying a path, query or fragment. */
export function hasUnusableAppUrl(env: MailEnv = process.env): boolean {
  return (
    Boolean(env.NEXT_PUBLIC_APP_URL?.trim()) &&
    !usableUrl(env.NEXT_PUBLIC_APP_URL)
  );
}

/** The host a request arrived on, behind Vercel's proxy. */
export function requestHost(req: Request): string | null {
  return req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? null;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * The deployment is emitting links to a host that is not its own.
 *
 * This is BUG-008's second failure: a preview or staging deployment reads its
 * own database, so a link on any other host sends the recipient somewhere the
 * invitation row does not exist and the page reports an invalid token. Only
 * reported when the deployment's own hosts are known, so it never guesses
 * off-platform.
 */
export function linkHostMismatch(
  env: MailEnv = process.env,
): { resolved: string; expected: string[] } | null {
  if (!env.VERCEL_ENV || env.VERCEL_ENV === "development") return null;
  const own = deploymentHosts(env);
  if (own.length === 0) return null;
  const productionHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
    .replace(/^https?:\/\//, "")
    .toLowerCase();
  // On production the canonical domain is expected and is not a branch host.
  const expected =
    env.VERCEL_ENV === "production" && productionHost
      ? [...own, productionHost]
      : own;
  const resolved = hostOf(appUrlBase(env));
  return expected.includes(resolved) ? null : { resolved, expected };
}

export type LinkHostVerdict = {
  /** "wrong" is provable from the environment; "unconfirmed" is not. */
  severity: "wrong" | "unconfirmed";
  resolved: string;
  expected: string[];
  message: string;
};

/**
 * The single classification of a link-host problem, shared by the admin panel,
 * both invite routes and both scripts.
 *
 * Resolving to the production host from a non-production deployment is
 * provably the bug — that is the value a project-wide NEXT_PUBLIC_APP_URL
 * bakes into a staging build. Any other unrecognised host may be a custom
 * staging domain aliased to this deployment, which Vercel does not expose:
 * deploymentHosts() only ever holds *.vercel.app values, so treating that as
 * broken would fire permanently on the correct configuration and train the
 * operator to ignore the case that matters.
 */
export function linkHostVerdict(
  env: MailEnv = process.env,
  /* The host the current request actually arrived on. By construction it
     aliases THIS deployment, which is the one thing Vercel's env vars cannot
     tell us — so it turns most "unconfirmed" verdicts into decided ones. */
  requestHost?: string | null,
): LinkHostVerdict | null {
  /* A deployed environment emitting localhost links is unambiguously broken
     and needs no host to compare against, so it is decided here rather than
     being a fourth rule each caller has to remember. */
  const base = appUrlBase(env);
  /* "development" is `vercel dev`, and `vercel env pull` writes it into
     .env.local — localhost links are correct there. Excluded for the same
     reason linkHostMismatch excludes it, so the file does not classify one
     environment two ways. */
  if (
    env.VERCEL_ENV &&
    env.VERCEL_ENV !== "development" &&
    base.startsWith("http://localhost")
  ) {
    return {
      severity: "wrong",
      resolved: "localhost",
      expected: deploymentHosts(env),
      message:
        "Invite links resolve to localhost on a deployed environment. Set NEXT_PUBLIC_APP_URL for this environment.",
    };
  }

  const mismatch = linkHostMismatch(env);
  if (!mismatch) return null;
  const productionHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
    .replace(/^https?:\/\//, "")
    .toLowerCase();
  if (productionHost && mismatch.resolved === productionHost) {
    return {
      severity: "wrong",
      ...mismatch,
      message: `Invite links resolve to the production host (${mismatch.resolved}) from a ${env.VERCEL_ENV} deployment. Recipients would land where the invitation does not exist. Set NEXT_PUBLIC_APP_URL for this environment.`,
    };
  }
  /* The header is proxy-supplied and only ever used to settle a host we could
     not otherwise confirm — never to suppress the provable case above, or a
     forged x-forwarded-host would silence both the owner warning and the log. */
  const arrivedOn = requestHost?.trim().toLowerCase();
  if (arrivedOn && arrivedOn === mismatch.resolved) return null;
  return {
    severity: "unconfirmed",
    ...mismatch,
    message: `Invite links resolve to ${mismatch.resolved}. Vercel reports this deployment at ${mismatch.expected.join(", ")}, so that host cannot be confirmed automatically — check it is an alias of THIS deployment and not of another environment, or invitations sent from here read as invalid.`,
  };
}

export function appUrl(path: string): string {
  const base = appUrlBase();
  if (
    base === "http://localhost:3000" &&
    process.env.NODE_ENV === "production"
  ) {
    console.warn(
      "appUrl: no usable app URL is configured — emitting localhost links. Set NEXT_PUBLIC_APP_URL in the deployment environment.",
    );
  }
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
