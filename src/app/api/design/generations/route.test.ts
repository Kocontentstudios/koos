import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const listDesignGenerationsForBrand = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (...a: unknown[]) => checkBrandAccess(...a),
  listDesignGenerationsForBrand: (...a: unknown[]) =>
    listDesignGenerationsForBrand(...a),
}));
vi.mock("@/lib/design/serialize", () => ({
  serializeGeneration: async (r: { id: string }) => ({ id: r.id }),
}));

import { GET } from "./route";

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const G1 = "11111111-1111-1111-1111-111111111111";
const G2 = "22222222-2222-2222-2222-222222222222";

const call = (qs: string) =>
  GET(new Request(`http://x/api/design/generations?brandId=${BRAND}${qs}`));

const optsOf = () =>
  listDesignGenerationsForBrand.mock.calls[0]?.[1] as {
    ids?: string[];
    limit?: number;
  };

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUser.mockResolvedValue({ dbUser: { id: "u1", role: "user" } });
  checkBrandAccess.mockResolvedValue({ ok: true });
  listDesignGenerationsForBrand.mockResolvedValue([{ id: G1 }, { id: G2 }]);
});

/* A just-finished run needs the rows it produced, not "the newest N for this
   brand" — that window misses them whenever anything newer exists, which is
   how a successful generation rendered "No designs yet" (KOOS-BUG-015). */
describe("fetching generations by id", () => {
  it("passes the ids through to the query", async () => {
    await call(`&ids=${G1},${G2}`);
    expect(optsOf().ids).toEqual([G1, G2]);
  });

  /* The limit must not cut an id list short: asking for three rows by id and
     getting two back is the same defect in a smaller window. */
  it("sizes the limit to the id list", async () => {
    await call(`&ids=${G1},${G2}&limit=1`);
    expect(optsOf().limit).toBe(2);
  });

  it("still applies the newest-first limit when no ids are given", async () => {
    await call("&limit=5");
    expect(optsOf().ids).toBeUndefined();
    expect(optsOf().limit).toBe(5);
  });

  it("tolerates whitespace around the ids", async () => {
    await call(`&ids=${G1}%20,%20${G2}`);
    expect(optsOf().ids).toEqual([G1, G2]);
  });
});

describe("the ids parameter is validated", () => {
  it.each([
    ["a non-uuid", "&ids=not-a-uuid"],
    ["a uuid and a non-uuid", `&ids=${G1},nope`],
    ["an empty list", "&ids=,"],
    ["an injection attempt", "&ids=1' OR '1'='1"],
  ])("rejects %s", async (_label, qs) => {
    const res = await call(qs);
    expect(res.status).toBe(400);
    expect(listDesignGenerationsForBrand).not.toHaveBeenCalled();
  });

  /* Bounded so the parameter cannot assemble an arbitrarily long IN list. */
  it("rejects more ids than a run could produce", async () => {
    const many = Array.from({ length: 21 }, () => G1).join(",");
    expect((await call(`&ids=${many}`)).status).toBe(400);
    expect(listDesignGenerationsForBrand).not.toHaveBeenCalled();
  });
});

/* An id is not a capability. The brand filter still applies, so a generation
   belonging to another brand cannot be read by guessing its id. */
describe("ids do not bypass brand access", () => {
  it("checks brand access before reading anything", async () => {
    checkBrandAccess.mockResolvedValue({ ok: false, error: "No", status: 403 });
    expect((await call(`&ids=${G1}`)).status).toBe(403);
    expect(listDesignGenerationsForBrand).not.toHaveBeenCalled();
  });

  it("refuses an anonymous caller", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    expect((await call(`&ids=${G1}`)).status).toBe(401);
    expect(listDesignGenerationsForBrand).not.toHaveBeenCalled();
  });

  it("still scopes the query to the brand", async () => {
    await call(`&ids=${G1}`);
    expect(listDesignGenerationsForBrand.mock.calls[0][0]).toBe(BRAND);
  });
});
