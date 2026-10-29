import { readFileSync } from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { designGenerations } from "@/lib/db/schema";

const sql = readFileSync(
  path.join(process.cwd(), "drizzle", "0037_design_documents.sql"),
  "utf8",
);

/* Applied before the old bundle stops serving, so it may only add what that
   bundle never names: nullable columns, no defaults to backfill, no drops. */
describe("0037_design_documents", () => {
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s) =>
      s
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);

  it("only adds columns, each guarded for a re-run", () => {
    expect(statements).toHaveLength(4);
    for (const statement of statements) {
      expect(statement).toMatch(
        /^ALTER TABLE "design_generations" ADD COLUMN IF NOT EXISTS "\w+"/,
      );
      expect(statement).not.toMatch(/NOT NULL|DEFAULT|DROP|RENAME/i);
    }
  });

  it("agrees with the drizzle schema", () => {
    const columns = getTableColumns(designGenerations);
    for (const [name, column] of [
      ["document", columns.document],
      ["rationale", columns.rationale],
      ["image_source", columns.imageSource],
      ["source_image_key", columns.sourceImageKey],
    ] as const) {
      expect(column.name).toBe(name);
      expect(column.notNull).toBe(false);
      expect(sql).toContain(`"${name}"`);
    }
  });
});

const noneSql = readFileSync(
  path.join(process.cwd(), "drizzle", "0038_design_image_source_none.sql"),
  "utf8",
);

/* Round 8 added "none" to the schema's enum and not to 0037's CHECK, so
   every no-image direction failed to insert. */
describe("0038_design_image_source_none", () => {
  const allowed = (text: string) =>
    [
      ...(/"image_source" IN \(([^)]*)\)/.exec(text)?.[1] ?? "").matchAll(
        /'(\w+)'/g,
      ),
    ].map((m) => m[1]);

  it("allows exactly the image sources the drizzle schema names", () => {
    expect(allowed(noneSql)).toEqual(
      getTableColumns(designGenerations).imageSource.enumValues,
    );
    expect(allowed(noneSql)).toEqual(["upload", "ko", "none"]);
  });

  it("replaces 0037's constraint by name, and only widens it", () => {
    expect(noneSql).toMatch(
      /DROP CONSTRAINT IF EXISTS "design_generations_image_source_check"/,
    );
    expect(noneSql).toMatch(
      /ADD CONSTRAINT "design_generations_image_source_check"/,
    );
    expect(allowed(sql)).toEqual(["upload", "ko"]);
    for (const value of allowed(sql)) {
      expect(allowed(noneSql)).toContain(value);
    }
  });
});
