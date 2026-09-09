/**
 * Static guards on drizzle/*.sql. These catch the failure modes that only
 * surface against a live database — where nobody sees them until a deploy.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.resolve("drizzle");
const files = (await readdir(dir))
  .filter((f) => f.endsWith(".sql"))
  .sort((a, b) => a.localeCompare(b));
const sources = Object.fromEntries(
  await Promise.all(
    files.map(async (f) => [f, await readFile(path.join(dir, f), "utf8")]),
  ),
);

/** Postgres truncates identifiers at 63 bytes (NAMEDATALEN - 1). */
const MAX_IDENTIFIER_BYTES = 63;

describe("migration files", () => {
  it("there is at least one", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    /* A name longer than this is silently truncated on creation, so the
       constraint exists under a DIFFERENT name than the migration says. Any
       later DROP CONSTRAINT by that name fails, and drizzle-kit reports
       permanent drift. */
    it(`${file}: every declared identifier fits in ${MAX_IDENTIFIER_BYTES} bytes`, () => {
      const sql = sources[file];
      const declared = [
        ...sql.matchAll(/(?:ADD\s+)?CONSTRAINT\s+"([^"]+)"/gi),
        ...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+"([^"]+)"/gi),
        ...sql.matchAll(/CREATE\s+TABLE\s+"([^"]+)"/gi),
        ...sql.matchAll(/CREATE\s+TYPE\s+"([^"]+)"/gi),
      ].map((m) => m[1]);
      const tooLong = declared.filter(
        (name) => Buffer.byteLength(name, "utf8") > MAX_IDENTIFIER_BYTES,
      );
      expect(tooLong).toEqual([]);
    });

    /* scripts/migrate.mjs wraps each file in ONE transaction. Adding an enum
       value there is fine; USING it in the same transaction is not — Postgres
       raises "unsafe use of new value of enum type". So the rule is narrow:
       a value added by ALTER TYPE must not appear again in the same file.
       Where a migration needs both, it creates a fresh enum type and swaps the
       column onto it — a type CREATEd in the transaction IS usable within it. */
    it(`${file}: never uses an enum value it added in the same transaction`, () => {
      const sql = sources[file];
      const added = [
        ...sql.matchAll(/ALTER\s+TYPE\s+[^\s]+\s+ADD\s+VALUE\s+'([^']+)'/gi),
      ].map((m) => ({ value: m[1], end: m.index + m[0].length }));
      const usedAfterAdding = added.filter(({ value, end }) =>
        sql.slice(end).includes(`'${value}'`),
      );
      expect(usedAfterAdding.map((u) => u.value)).toEqual([]);
    });

    it(`${file}: splits into non-empty statements`, () => {
      const statements = sources[file]
        .split("--> statement-breakpoint")
        .map((s) => s.trim());
      expect(statements.every((s) => s.length > 0)).toBe(true);
    });

    /* scripts/migrate.mjs runs at the START of `next build`, so the schema
       changes while the PREVIOUS bundle is still serving traffic, and drizzle
       names every column explicitly rather than selecting *. Removing
       something the live bundle still names turns each of its queries into an
       error for the length of the build, and there is no down migration to
       roll back to. Such a change is only safe once the code that stopped
       referencing it is already promoted — two deploys, not one.

       Deliberately narrow. ALTER TYPE ... RENAME TO is the repo's enum-swap
       recipe (0019, 0020) and is safe within one transaction, so it is not
       matched; SET NOT NULL is backward-incompatible in principle but has one
       historical use and no rule that would not be noise. */
    it(`${file}: any backward-incompatible drop declares its two-phase deploy`, () => {
      const sql = sources[file];
      const drops = [
        ...sql.matchAll(/(?:DROP\s+(?:COLUMN|TABLE)|RENAME\s+COLUMN)\b/gi),
      ].map((m) => m[0]);
      if (drops.length === 0) return;
      expect(
        sql,
        `${file} removes something the running bundle may still query. Ship the code that stops referencing it first, let it promote, then land this file with a "-- two-phase: <ref>" line naming that deploy.`,
      ).toMatch(/^--\s*two-phase:\s*\S+/im);
    });
  }
});
