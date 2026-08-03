import { describe, expect, it, vi } from "vitest";

// quota.ts imports the queries barrel, which constructs the db client at
// import time and throws without DATABASE_URL.
vi.mock("@/lib/db/queries", () => ({
  countDesignGenerationsForWorkspace: vi.fn(),
}));

import {
  DEFAULT_MONTHLY_QUOTA,
  monthEnd,
  monthStart,
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
