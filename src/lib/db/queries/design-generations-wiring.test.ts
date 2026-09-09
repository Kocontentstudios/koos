import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordingDb } from "./query-recorder";

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

import { listDesignGenerationsForBrand } from "./index";

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const G1 = "11111111-1111-1111-1111-111111111111";
const G2 = "22222222-2222-2222-2222-222222222222";

let rec: ReturnType<typeof recordingDb>;
beforeEach(() => {
  rec = recordingDb([]);
  setCurrent(rec as unknown as { db: Record<string, unknown> });
});

const sql = () => rec.recorded.where?.sql ?? "";
const params = () => rec.recorded.where?.params ?? [];

/* Passing `ids` into the query options is not the same as filtering on them.
   Mocking `db` as an object leaves the builder unexecuted, so a query that
   silently ignored the ids — returning the newest rows for the brand instead,
   which is the exact bug KOOS-BUG-015 reports — passed a green suite. This
   reads the compiled WHERE. */
describe("listDesignGenerationsForBrand compiles its filters", () => {
  it("filters on the ids it was given", async () => {
    await listDesignGenerationsForBrand(BRAND, { ids: [G1, G2] });
    expect(sql()).toContain('"design_generations"."id" in');
    expect(params()).toEqual(expect.arrayContaining([G1, G2]));
  });

  /* An id is not a capability: the brand filter must survive alongside it, or
     a generation on another brand could be read by guessing its id. */
  it("keeps the brand filter when filtering by id", async () => {
    await listDesignGenerationsForBrand(BRAND, { ids: [G1] });
    expect(sql()).toContain('"design_generations"."brand_id" =');
    expect(params()).toContain(BRAND);
  });

  it("adds no id clause when none are given", async () => {
    await listDesignGenerationsForBrand(BRAND, { limit: 10 });
    expect(sql()).not.toContain('"design_generations"."id" in');
    expect(sql()).toContain('"design_generations"."brand_id" =');
  });

  /* An empty list means "no id filter", not "match nothing". Drizzle compiles
     an empty inArray to a clause that can never be true, so passing it through
     would return zero rows for a caller that simply had nothing to narrow by.
     Compared against the unfiltered WHERE, because the empty form does not
     contain the string an id filter normally would. */
  it("ignores an empty id list rather than matching nothing", async () => {
    await listDesignGenerationsForBrand(BRAND, { ids: [] });
    const withEmpty = sql();

    rec = recordingDb([]);
    setCurrent(rec as unknown as { db: Record<string, unknown> });
    await listDesignGenerationsForBrand(BRAND, {});

    expect(withEmpty).toBe(sql());
  });

  it("still narrows by brief and calendar item alongside ids", async () => {
    await listDesignGenerationsForBrand(BRAND, {
      ids: [G1],
      briefId: G2,
    });
    expect(sql()).toContain('"design_generations"."id" in');
    expect(sql()).toContain('"design_generations"."brief_id" =');
  });

  /* Newest first, so a caller that does NOT ask by id gets the recent page it
     expects rather than an arbitrary one. */
  it("orders newest first", async () => {
    await listDesignGenerationsForBrand(BRAND, {});
    expect(rec.recorded.orderBy[0]).toContain(
      '"design_generations"."created_at" desc',
    );
  });

  it("applies the caller's limit", async () => {
    await listDesignGenerationsForBrand(BRAND, { limit: 7 });
    expect(rec.recorded.limit).toBe(7);
  });
});
