/**
 * Idempotent SQL migration runner. Runs before `next build` (see package.json
 * "build"), so pending migrations are applied at deploy time.
 *
 * Why a custom runner and not `drizzle-kit migrate`? This repo gitignores
 * `drizzle/meta/`, so drizzle's migration journal is not version-controlled and
 * its native migrator has nothing to track against. This runner keeps its own
 * ledger in a `_migrations` table and applies each `drizzle/*.sql` file exactly
 * once, in filename order.
 *
 * Behavior:
 *   - No DATABASE_URL/DIRECT_URL   → skip (exit 0). Lets local/offline builds run.
 *   - SKIP_MIGRATIONS=1            → skip (exit 0). Escape hatch.
 *   - A pending file fails to apply → exit 1 (fails the build/deploy).
 *
 * DDL needs a direct (session-mode) connection, so DIRECT_URL is preferred over
 * the pooled DATABASE_URL, mirroring drizzle.config.ts.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const C = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
};
const ok = (m) => console.log(`${C.green}✓${C.reset} ${m}`);
const warn = (m) => console.log(`${C.yellow}⚠${C.reset} ${m}`);
const bad = (m) => console.log(`${C.red}✗${C.reset} ${m}`);

try {
  process.loadEnvFile(".env");
} catch {
  // rely on ambient env (CI / Vercel)
}

if (process.env.SKIP_MIGRATIONS === "1") {
  console.log(`${C.dim}↷ Migrations skipped (SKIP_MIGRATIONS=1).${C.reset}`);
  process.exit(0);
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  warn("Migrations skipped — no DIRECT_URL/DATABASE_URL set.");
  process.exit(0);
}

const dir = path.resolve("drizzle");
let files;
try {
  files = (await readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
} catch {
  warn(`Migrations skipped — no "${dir}" directory.`);
  process.exit(0);
}

const sql = postgres(url, {
  prepare: false,
  max: 1,
  connect_timeout: 15,
  idle_timeout: 5,
  // Suppress benign NOTICEs (e.g. "relation already exists, skipping" from
  // `create table if not exists`) so build logs only show real output.
  onnotice: () => {},
});

try {
  await sql`
    create table if not exists _migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;

  const applied = new Set(
    (await sql`select name from _migrations`).map((r) => r.name),
  );
  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    ok(`Migrations up to date (${applied.size} applied).`);
  } else {
    console.log(`Applying ${pending.length} pending migration(s)…`);
    for (const file of pending) {
      const raw = await readFile(path.join(dir, file), "utf8");
      const statements = raw
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      // DDL is transactional in Postgres: a failed statement rolls the whole
      // file back, so a migration is all-or-nothing and never half-applied.
      await sql.begin(async (tx) => {
        for (const statement of statements) {
          await tx.unsafe(statement);
        }
        await tx`insert into _migrations (name) values (${file})`;
      });
      ok(`applied ${file} (${statements.length} statement(s))`);
    }
    ok("Migrations up to date.");
  }
} catch (e) {
  bad(`Migration failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}
