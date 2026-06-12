/**
 * Build-time database preflight check.
 *
 * Runs before `next build` (see the "build" script in package.json). It opens a
 * real connection to DATABASE_URL and verifies two things:
 *   1. The database is reachable and the credentials are valid.
 *   2. The schema has been initialized (the "users" table exists).
 *
 * If either fails, it exits non-zero — which fails the build, and therefore the
 * Vercel deployment. This is intentional: a deploy with a misconfigured or
 * uninitialized database should never go live.
 *
 * Escape hatch: set SKIP_DB_CHECK=1 to bypass (e.g. offline / container builds
 * that genuinely have no database access at build time).
 */

import postgres from "postgres";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";

// A table that only exists once migrations have been pushed. This is the
// canonical "is the database initialized" marker — keep it in sync with schema.
const REQUIRED_TABLE = "users";

function fail(message) {
  console.error(`${RED}✗ DB preflight failed:${RESET} ${message}`);
  process.exit(1);
}

if (process.env.SKIP_DB_CHECK === "1") {
  console.log(`${DIM}↷ DB preflight skipped (SKIP_DB_CHECK=1).${RESET}`);
  process.exit(0);
}

// Load .env for local builds. On Vercel the vars are already in process.env and
// no .env file exists, so this is a best-effort, ignore-if-missing load.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file — rely on the ambient environment (CI / Vercel).
}

const url = process.env.DATABASE_URL;

if (!url) {
  fail(
    "DATABASE_URL is not set. Configure it in your environment (or Vercel " +
      "project settings) before building.",
  );
}

const sql = postgres(url, {
  prepare: false,
  // Fast, bounded, single-connection — we want a definitive pass/fail in CI.
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
});

try {
  // 1. Connectivity + authentication.
  await sql`select 1`;

  // 2. Schema initialized.
  const [{ initialized }] = await sql`
    select exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = ${REQUIRED_TABLE}
    ) as initialized
  `;

  if (!initialized) {
    await sql.end({ timeout: 5 }).catch(() => {});
    fail(
      `connected, but the "${REQUIRED_TABLE}" table is missing. ` +
        `Run "pnpm db:push" against this database before deploying.`,
    );
  }

  console.log(
    `${GREEN}✓ DB preflight passed${RESET} — database reachable and schema initialized.`,
  );
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
} catch (err) {
  await sql.end({ timeout: 5 }).catch(() => {});
  fail(err?.message ?? String(err));
}
