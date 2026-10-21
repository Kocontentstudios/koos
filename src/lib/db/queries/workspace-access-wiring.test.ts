import { beforeEach, describe, expect, it, vi } from "vitest";

/* Records the UPDATE that setWorkspaceAccess builds. The condition on the
   current status is what makes a double-clicked Approve send one email, so
   it is asserted on the compiled SQL rather than trusted. */
const { dbProxy, recorded } = vi.hoisted(() => {
  const recorded: { set?: Record<string, unknown>; where?: unknown } = {};
  const builder = {
    set(values: Record<string, unknown>) {
      recorded.set = values;
      return builder;
    },
    where(condition: unknown) {
      recorded.where = condition;
      return builder;
    },
    returning() {
      return Promise.resolve([]);
    },
  };
  return { recorded, dbProxy: { update: () => builder } };
});

vi.mock("@/lib/db/client", () => ({ db: dbProxy }));

import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { setWorkspaceAccess } from "./workspace-access";

const dialect = new PgDialect();

describe("setWorkspaceAccess", () => {
  beforeEach(() => {
    recorded.set = undefined;
    recorded.where = undefined;
  });

  it("only updates a workspace whose status actually changes", async () => {
    await setWorkspaceAccess("w1", "approved", "admin-1");
    const { sql, params } = dialect.sqlToQuery(recorded.where as SQL);
    expect(sql).toContain('"workspaces"."id" =');
    expect(sql).toContain('"workspaces"."access_status" <>');
    expect(params).toEqual(["w1", "approved"]);
  });

  it("records who decided and when", async () => {
    await setWorkspaceAccess("w1", "approved", "admin-1");
    expect(recorded.set).toMatchObject({
      accessStatus: "approved",
      accessDecidedBy: "admin-1",
    });
    expect(recorded.set?.accessDecidedAt).toBeInstanceOf(Date);
  });

  it("returns null when nothing changed", async () => {
    await expect(
      setWorkspaceAccess("w1", "approved", "admin-1"),
    ).resolves.toBeNull();
  });
});
