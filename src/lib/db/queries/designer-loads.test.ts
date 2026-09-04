import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordingDb } from "./query-recorder";

/* The one GROUP BY in this change, and nothing executed it. Three separate
   mutations survived a full suite against this single query — including one
   that makes Postgres raise 42803 and takes the whole /admin dashboard into
   the error boundary, because getDesignerLoads is awaited inside the page's
   Promise.all. */
const { dbProxy, setCurrent } = vi.hoisted(() => {
  let current: { db: Record<string, unknown> };
  return {
    dbProxy: new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => current.db[prop as string],
    }),
    setCurrent: (next: { db: Record<string, unknown> }) => {
      current = next;
    },
  };
});

vi.mock("@/lib/db/client", () => ({ db: dbProxy }));

import { VIEW_PREDICATES } from "@/lib/admin/scope";
import { getDesignerLoads, releaseRateLimit } from "./index";

let rec: ReturnType<typeof recordingDb>;
beforeEach(() => {
  rec = recordingDb([]);
  setCurrent(rec as unknown as { db: Record<string, unknown> });
});

describe("getDesignerLoads", () => {
  /* Postgres requires every non-aggregated projected column in the GROUP BY.
     Adding `email` to the projection without adding it here is error 42803 at
     runtime — a green suite and a dead dashboard. */
  /* `sources` records a Column as `table.column` and a projected sql fragment
     as compiled SQL, so comparing the two needs a normal form. designerId is
     projected as a fragment and grouped as a Column — the same column, two
     spellings. */
  const columnsIn = (value: string) =>
    Array.from(value.matchAll(/"?([a-z_]+)"?\."?([a-z_]+)"?/g)).map(
      (m) => `${m[1]}.${m[2]}`,
    );

  it("groups by every non-aggregated column it projects", async () => {
    await getDesignerLoads();
    const grouped = new Set(rec.recorded.groupBy.flatMap(columnsIn));

    for (const [key, source] of Object.entries(rec.recorded.sources)) {
      // count() is an aggregate; it names no column.
      if (key === "count") continue;
      for (const column of columnsIn(source)) {
        expect(
          grouped,
          `${key} projects ${column}, which is not in the GROUP BY`,
        ).toContain(column);
      }
    }
  });

  it("projects the email the card falls back to", async () => {
    await getDesignerLoads();
    expect(rec.recorded.sources.email).toBe("users.email");
    expect(rec.recorded.groupBy).toContain("users.email");
  });

  /* The specific 42803: `email` was added to the projection in the same change
     that added it here. Dropping either half is a runtime error that takes the
     whole dashboard into the error boundary. */
  it("groups by the email it projects", async () => {
    await getDesignerLoads();
    expect(rec.recorded.groupBy).toContain("users.email");
  });

  /* The count must resolve the SAME predicate as `?view=active`, which is
     where the row links. A literal here, or a different view, is the
     count-vs-list drift this epic exists to remove. */
  it("counts the active view, not everything", async () => {
    await getDesignerLoads();
    const params = rec.recorded.where?.params ?? [];
    for (const status of VIEW_PREDICATES.active.statusIn ?? []) {
      expect(params).toContain(status);
    }
    expect(rec.recorded.where?.sql).toContain('"design_tickets"."status" in');
  });

  it("excludes statuses the active view excludes", async () => {
    await getDesignerLoads();
    const params = rec.recorded.where?.params ?? [];
    for (const status of ["draft", "delivered", "submitted"]) {
      expect(params).not.toContain(status);
    }
  });

  /* Without this the unassigned pile groups into a designerId:null row, which
     renders as "Unknown — N active" linking to an unfiltered list. */
  it("counts only tickets someone is actually carrying", async () => {
    await getDesignerLoads();
    expect(rec.recorded.where?.sql).toContain(
      '"design_tickets"."assigned_designer_id" is not null',
    );
  });
});

describe("releaseRateLimit", () => {
  /* An unbounded DELETE here truncates rate_limits: login throttling, the
     contact form and every AI limiter reset at once. The WHERE is the only
     thing between one compensating action and a site-wide limiter wipe. */
  it("deletes exactly one key", async () => {
    await releaseRateLimit("ticket-remind:t1");
    expect(rec.recorded.from).toBe("rate_limits");
    expect(rec.recorded.where).toBeDefined();
    expect(rec.recorded.where?.sql).toContain('"rate_limits"."key" =');
    expect(rec.recorded.where?.params).toEqual(["ticket-remind:t1"]);
  });

  it("never issues an unscoped delete", async () => {
    await releaseRateLimit("anything");
    expect(rec.recorded.where?.params).toHaveLength(1);
  });
});
