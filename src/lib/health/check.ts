/**
 * Liveness probe logic, kept out of the route so it can be tested without a
 * database.
 *
 * The 2026-09-23 outage is the shape this exists to catch: the Aiven service
 * was powered off for days, its DNS record disappeared, and every page still
 * answered 200 because the login shell is static. Only a real query against a
 * real table proves the app can serve a logged-in request.
 */

export type ProbeStatus = "ok" | "down";
export type ProbeFailure = "unreachable" | "timeout" | "error";

export type ProbeResult = {
  status: ProbeStatus;
  latencyMs: number;
  /** Failure class, never the driver message: it carries the DB host. */
  error?: ProbeFailure;
};

/* Longer than postgres.js's connect_timeout (10s, src/lib/db/client.ts), so a
   blackholed connect surfaces as the driver's own unreachable error instead of
   being relabelled a timeout and sending the responder to the wrong runbook
   row. */
export const PROBE_TIMEOUT_MS = 12_000;
/** Unauthenticated endpoint, one DB connection per serverless instance: without
 *  a cache a request loop becomes the connection exhaustion this reports on. */
export const PROBE_CACHE_MS = 10_000;

const TIMEOUT_MARKER = "koos.health.timeout";

/** DNS and socket failures: the service is gone, not merely slow. */
const UNREACHABLE_CODES = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

/**
 * Three classes, because they send a responder to different places: the
 * service is gone, the query never came back, or the database answered with a
 * complaint (bad credentials, connection cap, missing table).
 */
function classify(error: unknown): ProbeFailure {
  if (error instanceof Error && error.message === TIMEOUT_MARKER) {
    return "timeout";
  }
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  return UNREACHABLE_CODES.has(code) ? "unreachable" : "error";
}

export async function probeDatabase(
  runQuery: () => Promise<unknown>,
  options: { timeoutMs?: number; now?: () => number } = {},
): Promise<ProbeResult> {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  /* Called, not captured: holding a reference to Date.now pins the clock that
     existed at module load, which a test's fake timers can never move. */
  const now = options.now ?? (() => Date.now());
  const started = now();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(TIMEOUT_MARKER)), timeoutMs);
  });

  try {
    await Promise.race([runQuery(), timeout]);
    return { status: "ok", latencyMs: now() - started };
  } catch (error) {
    return {
      status: "down",
      latencyMs: now() - started,
      error: classify(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

type CacheEntry = { result: ProbeResult; at: number };

/**
 * Serves a recent probe rather than querying per request. Bounded by
 * PROBE_CACHE_MS, so a monitor on any sane interval still sees live state.
 */
export function createCachedProbe(
  probe: () => Promise<ProbeResult>,
  options: { ttlMs?: number; now?: () => number } = {},
) {
  const ttlMs = options.ttlMs ?? PROBE_CACHE_MS;
  const now = options.now ?? (() => Date.now());
  let cached: CacheEntry | null = null;
  let inFlight: Promise<ProbeResult> | null = null;

  return async function cachedProbe(): Promise<ProbeResult> {
    if (cached && now() - cached.at < ttlMs) return cached.result;
    // Collapse a burst onto one query instead of one per concurrent request.
    if (inFlight) return inFlight;

    inFlight = probe()
      .then((result) => {
        cached = { result, at: now() };
        return result;
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  };
}

/**
 * 503 on a failed probe so an uptime monitor treats it as an incident; a
 * 200-with-a-sad-body would page nobody.
 */
export function httpStatusFor(result: ProbeResult): number {
  return result.status === "ok" ? 200 : 503;
}

export function healthBody(
  result: ProbeResult,
  meta: { commit?: string; environment?: string; timestamp: string },
) {
  return {
    status: result.status === "ok" ? "ok" : "degraded",
    database: result.status,
    latencyMs: result.latencyMs,
    ...(result.error ? { reason: result.error } : {}),
    commit: meta.commit ?? "unknown",
    environment: meta.environment ?? "unknown",
    timestamp: meta.timestamp,
  };
}
