import { readFileSync } from "node:fs";
import path from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { workspaces } from "@/lib/db/schema";

const sql = readFileSync(
  path.join(process.cwd(), "drizzle", "0036_workspace_access_gate.sql"),
  "utf8",
);

/* Ordering is the whole migration: adding the column with DEFAULT 'pending'
   would lock every existing client out of the app on deploy. */
describe("0036_workspace_access_gate", () => {
  const addApproved = sql.indexOf(
    `ADD COLUMN IF NOT EXISTS "access_status" "workspace_access_status" NOT NULL DEFAULT 'approved'`,
  );
  const flipToPending = sql.indexOf(
    `ALTER COLUMN "access_status" SET DEFAULT 'pending'`,
  );

  it("grandfathers existing workspaces by adding the column as approved", () => {
    expect(addApproved).toBeGreaterThan(-1);
  });

  it("only then makes new workspaces default to pending", () => {
    expect(flipToPending).toBeGreaterThan(addApproved);
  });

  it("agrees with the schema's default for new rows", () => {
    expect(getTableColumns(workspaces).accessStatus.default).toBe("pending");
  });
});
