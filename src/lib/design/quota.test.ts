import { afterEach, describe, expect, it, vi } from "vitest";

// quota.ts imports the queries barrel, which constructs the db client at
// import time and throws without DATABASE_URL.
vi.mock("@/lib/db/queries", () => ({
  countDesignGenerationsForWorkspace: vi.fn(),
  countReservedDesignUnitsForWorkspace: vi.fn(),
}));

import {
  countDesignGenerationsForWorkspace,
  countReservedDesignUnitsForWorkspace,
} from "@/lib/db/queries";
import { ABANDONED_SET_MS } from "@/lib/jobs/stale";
import {
  checkDesignQuota,
  DEFAULT_MONTHLY_QUOTA,
  monthEnd,
  monthStart,
  quotaExceeded,
  quotaMessage,
  resolveMonthlyQuota,
} from "./quota";

describe("monthStart / monthEnd", () => {
  it("brackets the calendar month in UTC", () => {
    const now = new Date("2026-08-14T09:30:00Z");
    expect(monthStart(now).toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(monthEnd(now).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("rolls the year over in December", () => {
    const now = new Date("2026-12-31T23:59:59Z");
    expect(monthEnd(now).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("resolveMonthlyQuota", () => {
  it("defaults when unset", () => {
    expect(resolveMonthlyQuota({})).toBe(DEFAULT_MONTHLY_QUOTA);
  });

  it("reads a configured limit", () => {
    expect(resolveMonthlyQuota({ DESIGN_GENERATION_MONTHLY_QUOTA: "50" })).toBe(
      50,
    );
  });

  it("ignores values that would disable the guard", () => {
    for (const bad of ["0", "-5", "abc", ""]) {
      expect(
        resolveMonthlyQuota({ DESIGN_GENERATION_MONTHLY_QUOTA: bad }),
      ).toBe(DEFAULT_MONTHLY_QUOTA);
    }
  });
});

/* KOOS-AI-002: a set is charged one unit per frame, so it is refused up
   front when the workspace cannot pay for all of it (H7). */
describe("checkDesignQuota with a requested count", () => {
  const now = new Date("2026-10-14T09:30:00Z");

  async function verdictFor(used: number, requested?: number) {
    vi.mocked(countDesignGenerationsForWorkspace).mockResolvedValue(used);
    return requested === undefined
      ? checkDesignQuota("w1", now)
      : checkDesignQuota("w1", now, requested);
  }

  it("asks for one unit by default, exactly as before", async () => {
    expect((await verdictFor(DEFAULT_MONTHLY_QUOTA - 1)).ok).toBe(true);
    expect((await verdictFor(DEFAULT_MONTHLY_QUOTA)).ok).toBe(false);
    expect((await verdictFor(0)).requested).toBe(1);
  });

  it("is ok only when every requested unit fits", async () => {
    expect((await verdictFor(DEFAULT_MONTHLY_QUOTA - 7, 7)).ok).toBe(true);
    expect((await verdictFor(DEFAULT_MONTHLY_QUOTA - 6, 7)).ok).toBe(false);
  });

  it("keeps the single-design message word for word", async () => {
    const verdict = await verdictFor(DEFAULT_MONTHLY_QUOTA);
    expect(quotaMessage(verdict)).toBe(
      `This workspace has used all ${DEFAULT_MONTHLY_QUOTA} design generations for this month. The allowance resets on 2026-11-01.`,
    );
    const body = await quotaExceeded(verdict).json();
    expect(body).not.toHaveProperty("requested");
  });

  it("names the shortfall for a set", async () => {
    const verdict = await verdictFor(DEFAULT_MONTHLY_QUOTA - 4, 7);
    expect(quotaMessage(verdict, "carousel")).toBe(
      "This carousel needs 7 designs; this workspace has 4 left this month. The allowance resets on 2026-11-01.",
    );
    const res = quotaExceeded(verdict, "carousel");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({
      requested: 7,
      used: DEFAULT_MONTHLY_QUOTA - 4,
      limit: DEFAULT_MONTHLY_QUOTA,
    });
  });

  it("says none are left rather than a negative count", async () => {
    const verdict = await verdictFor(DEFAULT_MONTHLY_QUOTA + 3, 5);
    expect(quotaMessage(verdict, "presentation")).toMatch(
      /^This presentation needs 5 designs; this workspace has none left this month\./,
    );
  });
});

/* KOOS-AI-002: a set bills frame by frame as each lands, so the units its
   frames still to come are owed count as used until they land or fail;
   otherwise two sets started together both pass on the same units (H7). */
describe("checkDesignQuota with sets in flight", () => {
  const now = new Date("2026-10-14T09:30:00Z");

  afterEach(() => {
    process.env.FEATURE_MULTI_FRAME = "";
  });

  it("counts the units running sets are owed when sets are on", async () => {
    process.env.FEATURE_MULTI_FRAME = "1";
    vi.mocked(countDesignGenerationsForWorkspace).mockResolvedValue(
      DEFAULT_MONTHLY_QUOTA - 14,
    );
    vi.mocked(countReservedDesignUnitsForWorkspace).mockResolvedValue(7);
    expect(await checkDesignQuota("w1", now, 7)).toMatchObject({
      ok: true,
      used: DEFAULT_MONTHLY_QUOTA - 7,
    });
    vi.mocked(countReservedDesignUnitsForWorkspace).mockResolvedValue(8);
    expect((await checkDesignQuota("w1", now, 7)).ok).toBe(false);
  });

  it("asks only about sets still heard from", async () => {
    process.env.FEATURE_MULTI_FRAME = "1";
    vi.mocked(countDesignGenerationsForWorkspace).mockResolvedValue(0);
    vi.mocked(countReservedDesignUnitsForWorkspace).mockResolvedValue(0);
    await checkDesignQuota("w1", now);
    expect(countReservedDesignUnitsForWorkspace).toHaveBeenCalledWith(
      "w1",
      new Date(now.getTime() - ABANDONED_SET_MS),
    );
  });

  it("is the one query it always was with sets off", async () => {
    vi.mocked(countReservedDesignUnitsForWorkspace).mockClear();
    vi.mocked(countDesignGenerationsForWorkspace).mockResolvedValue(5);
    expect((await checkDesignQuota("w1", now)).used).toBe(5);
    expect(countReservedDesignUnitsForWorkspace).not.toHaveBeenCalled();
  });
});
