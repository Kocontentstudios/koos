import { timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  createCachedProbe,
  healthBody,
  httpStatusFor,
  probeDatabase,
} from "@/lib/health/check";

/* A cached health check reports the state of whenever it was cached, which is
   the one thing a monitor must never be told. The probe's own short cache is
   bounded and deliberate; Next's full-route cache is not. */
export const dynamic = "force-dynamic";

/**
 * Reads a real table rather than `select 1`.
 *
 * A socket check passes against an empty database that a deploy has just
 * recreated, which is precisely when someone needs to be told. `_migrations`
 * is written by scripts/migrate.mjs and is never legitimately empty in a
 * deployed environment.
 */
const probe = createCachedProbe(() =>
  probeDatabase(async () => {
    const rows = await db.execute<{ applied: number }>(
      sql`select count(*)::int as applied from _migrations`,
    );
    const applied = Number(rows[0]?.applied ?? 0);
    if (applied === 0) {
      throw new Error("no migrations applied — database is empty");
    }
    return applied;
  }),
);

function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Public liveness endpoint. Deliberately unauthenticated by default — an
 * uptime monitor has no session, and auth itself needs the database this
 * exists to check. It returns a status, a latency and the deployed commit,
 * never connection details.
 *
 * The probe result is cached briefly, but that cache is per serverless
 * instance, so concurrent requests still fan out across instances and each
 * opens its own connection. Setting HEALTH_PROBE_TOKEN closes that off: the
 * monitor sends `x-health-token` and everyone else is refused before any
 * database work happens.
 */
export async function GET(request: Request) {
  const expected = process.env.HEALTH_PROBE_TOKEN;
  if (
    expected &&
    !tokenMatches(request.headers.get("x-health-token"), expected)
  ) {
    return Response.json(
      { status: "unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const result = await probe();

  const body = healthBody(result, {
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });

  return Response.json(body, {
    status: httpStatusFor(result),
    headers: { "cache-control": "no-store" },
  });
}
