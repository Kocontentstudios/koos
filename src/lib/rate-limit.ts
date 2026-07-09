/**
 * Postgres-backed fixed-window rate limiting.
 *
 * Usage (route handler):
 *   const verdict = await checkRateLimit({
 *     key: `contact:${clientIpFrom(req.headers)}`,
 *     limit: 5,
 *     windowSeconds: 3600,
 *   });
 *   if (!verdict.ok) return tooManyRequests(verdict);
 *
 * Server actions build the key from `await headers()` instead.
 *
 * Fails OPEN: if the counter query errors (DB hiccup), the request is
 * allowed and the failure logged — a limiter outage must never lock every
 * user out of login or the AI features.
 */

export interface RateLimitPolicy {
  key: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitVerdict {
  ok: boolean;
  /** Seconds until the current window expires (0 when allowed). */
  retryAfterSeconds: number;
}

/** Pure window math, separated from I/O for unit testing. */
export function evaluateWindow(
  hit: { count: number; windowStart: Date },
  policy: Pick<RateLimitPolicy, "limit" | "windowSeconds">,
  now: Date = new Date(),
): RateLimitVerdict {
  if (hit.count <= policy.limit) {
    return { ok: true, retryAfterSeconds: 0 };
  }
  const elapsedSeconds = Math.floor(
    (now.getTime() - hit.windowStart.getTime()) / 1000,
  );
  return {
    ok: false,
    retryAfterSeconds: Math.max(1, policy.windowSeconds - elapsedSeconds),
  };
}

type HitFn = (
  key: string,
  windowSeconds: number,
) => Promise<{ count: number; windowStart: Date }>;

export async function checkRateLimit(
  policy: RateLimitPolicy,
  hit?: HitFn,
): Promise<RateLimitVerdict> {
  try {
    // Lazy-load the DB-backed counter so importing this module never forces a
    // database connection (keeps it usable in tests and non-DB contexts).
    const hitFn = hit ?? (await import("@/lib/db/queries")).hitRateLimit;
    const result = await hitFn(policy.key, policy.windowSeconds);
    return evaluateWindow(result, policy);
  } catch (err) {
    console.error(
      `rate limit check failed (allowing request): ${policy.key}`,
      err,
    );
    return { ok: true, retryAfterSeconds: 0 };
  }
}

/**
 * Best-effort caller IP. Behind Cloudflare + Vercel the first entry of
 * x-forwarded-for is the client. Falls back to "unknown" (shared bucket)
 * rather than skipping the limit entirely.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** 429 response with Retry-After for route handlers. */
export function tooManyRequests(verdict: RateLimitVerdict): Response {
  return Response.json(
    {
      error: "Too many requests. Please wait a moment and try again.",
    },
    {
      status: 429,
      headers: { "Retry-After": String(verdict.retryAfterSeconds) },
    },
  );
}
