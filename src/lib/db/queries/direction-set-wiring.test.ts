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

import { listDirectionSet } from "./index";

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const SET = "8c7f2e1a-0b5d-4c1e-9a77-1f2e3d4c5b6a";

let rec: ReturnType<typeof recordingDb>;
beforeEach(() => {
  rec = recordingDb([]);
  setCurrent(rec as unknown as { db: Record<string, unknown> });
});

describe("listDirectionSet compiles its filters", () => {
  /* The set id comes out of a row's jsonb, which a regenerate request points
     at. Without the brand filter a guessed set would read another brand's. */
  it("filters on the brand and on the set inside rationale", async () => {
    await listDirectionSet(BRAND, SET);
    const where = rec.recorded.where;
    expect(where?.sql).toContain('"design_generations"."brand_id" =');
    expect(where?.sql).toContain(`"design_generations"."rationale"->>'set' =`);
    expect(where?.params).toEqual(expect.arrayContaining([BRAND, SET]));
  });

  /* Round-1 regression: a limit of 20 dropped the sibling once one slot had
     20 rows, pending and failed ones included. */
  it("reads the whole set, newest first", async () => {
    await listDirectionSet(BRAND, SET);
    expect(rec.recorded.limit).toBeUndefined();
    expect(rec.recorded.orderBy.join(" ")).toContain("created_at");
  });
});
