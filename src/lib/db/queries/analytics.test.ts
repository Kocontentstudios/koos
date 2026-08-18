import { describe, expect, it, vi } from "vitest";
import {
  getActiveBrandCount,
  getApprovalDurationsSince,
  getSignupsSince,
  getTicketsSince,
  getTopBrandsByActivity,
  getUsageEventsSince,
} from "./analytics";

vi.mock("@/lib/db/client", () => ({ db: {} }));

describe("analytics queries", () => {
  it("exports callable query functions", () => {
    for (const fn of [
      getUsageEventsSince,
      getSignupsSince,
      getTicketsSince,
      getActiveBrandCount,
      getTopBrandsByActivity,
      getApprovalDurationsSince,
    ]) {
      expect(typeof fn).toBe("function");
    }
  });

  it("is re-exported from the queries barrel the pages import", async () => {
    const barrel = await import("./index");
    expect(typeof barrel.getUsageEventsSince).toBe("function");
    expect(typeof barrel.getTopBrandsByActivity).toBe("function");
  });
});
