import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const q = {
  briefs: vi.fn(),
  tickets: vi.fn(),
  strategies: vi.fn(),
  assets: vi.fn(),
  items: vi.fn(),
};

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (...a: unknown[]) => checkBrandAccess(...a),
  listDesignBriefsForBrand: (...a: unknown[]) => q.briefs(...a),
  listDesignTicketsForBrand: (...a: unknown[]) => q.tickets(...a),
  getStrategiesByBrand: (...a: unknown[]) => q.strategies(...a),
  getBrandAssets: (...a: unknown[]) => q.assets(...a),
  listCalendarItemsForBrand: (...a: unknown[]) => q.items(...a),
}));

import { GET } from "./route";

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";

const call = () =>
  GET(new Request(`http://x/api/design/context?brandId=${BRAND}`));

const optionsOf = async (res: Response) =>
  (
    (await res.json()) as {
      options: {
        type: string;
        id: string;
        groupId?: string;
        groupLabel?: string;
      }[];
    }
  ).options;

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUser.mockResolvedValue({ dbUser: { id: "u1", role: "user" } });
  checkBrandAccess.mockResolvedValue({ ok: true });
  q.briefs.mockResolvedValue([]);
  q.tickets.mockResolvedValue([]);
  q.strategies.mockResolvedValue([]);
  q.assets.mockResolvedValue([]);
  q.items.mockResolvedValue([]);
});

describe("the picker sees every calendar", () => {
  /* The reported bug: the route read calendars[0] and nothing else, so a brief
     saved against any older campaign was unreachable and users copied it by
     hand. */
  it("asks for the brand's items across all calendars", async () => {
    await call();
    expect(q.items).toHaveBeenCalledWith(BRAND, expect.any(Number));
  });

  it("carries each item's calendar so the picker can group by it", async () => {
    q.items.mockResolvedValue([
      {
        id: "i1",
        title: "Launch teaser",
        platform: "Instagram",
        date: new Date("2026-09-01T00:00:00Z"),
        designRequired: true,
        calendarId: "cal-1",
        strategyName: "Harmattan launch",
      },
    ]);
    const options = await optionsOf(await call());
    const item = options.find((o) => o.type === "calendar_item");
    expect(item?.groupId).toBe("cal-1");
    expect(item?.groupLabel).toBe("Harmattan launch");
  });

  it("returns items from more than one calendar", async () => {
    q.items.mockResolvedValue(
      ["cal-1", "cal-2", "cal-3"].map((calendarId, i) => ({
        id: `i${i}`,
        title: `Item ${i}`,
        platform: "Instagram",
        date: null,
        designRequired: true,
        calendarId,
        strategyName: `Campaign ${i}`,
      })),
    );
    const options = await optionsOf(await call());
    const groups = new Set(
      options.filter((o) => o.type === "calendar_item").map((o) => o.groupId),
    );
    expect(groups).toEqual(new Set(["cal-1", "cal-2", "cal-3"]));
  });

  /* 30 briefs is the number the report names, and the old 40-per-type slice
     plus a single calendar is what cut it to roughly 12. */
  it("does not cut a realistic brand's calendar down", async () => {
    q.items.mockResolvedValue(
      Array.from({ length: 60 }, (_, i) => ({
        id: `i${i}`,
        title: `Item ${i}`,
        platform: "Instagram",
        date: null,
        designRequired: true,
        calendarId: i < 30 ? "cal-1" : "cal-2",
        strategyName: i < 30 ? "First" : "Second",
      })),
    );
    const options = await optionsOf(await call());
    expect(options.filter((o) => o.type === "calendar_item")).toHaveLength(60);
  });

  it("asks for briefs with room for a real history", async () => {
    await call();
    const limit = q.briefs.mock.calls[0][1] as number;
    expect(limit).toBeGreaterThanOrEqual(100);
  });
});

describe("who may read a brand's context", () => {
  it("refuses an anonymous caller", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    expect((await call()).status).toBe(401);
    expect(q.items).not.toHaveBeenCalled();
  });

  it("refuses someone without access to the brand", async () => {
    checkBrandAccess.mockResolvedValue({ ok: false, error: "No", status: 403 });
    expect((await call()).status).toBe(403);
    expect(q.items).not.toHaveBeenCalled();
  });

  it("rejects a brandId that is not a uuid", async () => {
    const res = await GET(
      new Request("http://x/api/design/context?brandId=nope"),
    );
    expect(res.status).toBe(400);
    expect(q.items).not.toHaveBeenCalled();
  });
});
