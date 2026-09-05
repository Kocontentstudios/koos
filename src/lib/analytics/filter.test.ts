import { describe, expect, it } from "vitest";
import { DEFAULT_SCOPE } from "@/lib/admin/scope-params";
import {
  analyticsFilterFrom,
  describeWindow,
  previousWindow,
  windowDays,
} from "./filter";

const NOW = new Date("2026-09-04T12:00:00Z");
const scope = (over = {}) => ({ ...DEFAULT_SCOPE, ...over });

describe("the scope becomes one filter every figure reads", () => {
  it("carries each control through", () => {
    const f = analyticsFilterFrom(
      scope({
        range: "7d",
        kind: ["design_generated"],
        status: ["delivered"],
        brand: "b1",
      }),
      NOW,
    );
    expect(f.kinds).toEqual(["design_generated"]);
    expect(f.statuses).toEqual(["delivered"]);
    expect(f.brandId).toBe("b1");
    expect(f.from).not.toBeNull();
  });

  it("reads an unset brand as no brand, not an empty string", () => {
    expect(analyticsFilterFrom(scope(), NOW).brandId).toBeNull();
  });

  it("is unbounded for the all range", () => {
    const f = analyticsFilterFrom(scope({ range: "all" }), NOW);
    expect(f.from).toBeNull();
    expect(f.to).toBeNull();
  });
});

describe("the comparison period is like for like", () => {
  /* A 30-day selection compared against the previous 7 days reports growth
     that is an artefact of the window, not of the product. */
  it.each([
    ["7d", 7],
    ["30d", 30],
    ["90d", 90],
  ])("%s compares against the %i days before it", (range, days) => {
    const f = analyticsFilterFrom(scope({ range }), NOW);
    const prev = previousWindow(f, NOW);
    if (!prev || !f.from) throw new Error("expected a bounded window");
    const spanOf = (a: Date, b: Date) =>
      Math.round((b.getTime() - a.getTime()) / 86_400_000);
    expect(spanOf(prev.from, prev.to)).toBe(days);
    // The previous window ends exactly where this one begins — no gap, no overlap.
    expect(prev.to.getTime()).toBe(f.from.getTime());
  });

  /* "All time" has no previous period. Inventing one would put a percentage
     on a card that cannot have a meaningful comparison. */
  it("has no previous period for an unbounded range", () => {
    const f = analyticsFilterFrom(scope({ range: "all" }), NOW);
    expect(previousWindow(f, NOW)).toBeNull();
  });

  it("matches a custom range's own length", () => {
    const f = analyticsFilterFrom(
      scope({ range: "custom", from: "2026-08-01", to: "2026-08-10" }),
      NOW,
    );
    const prev = previousWindow(f, NOW);
    if (!prev || !f.from || !f.to) throw new Error("expected bounds");
    expect(prev.to.getTime() - prev.from.getTime()).toBe(
      f.to.getTime() - f.from.getTime(),
    );
  });
});

describe("the window describes itself", () => {
  /* Captions used to be hardcoded ("last 7 days") and became lies the moment a
     filter was applied. */
  it.each([
    ["7d", "last 7 days"],
    ["30d", "last 30 days"],
    ["90d", "last 90 days"],
    ["all", "all time"],
  ])("%s reads as %s", (range, expected) => {
    expect(describeWindow(analyticsFilterFrom(scope({ range }), NOW))).toBe(
      expected,
    );
  });

  /* The regression this replaces an inverted assertion for: the old version
     pinned "last 10 days" for an Aug 1-10 range read on Sep 4, which is false.
     A hand-picked range is described by its DATES; only a rolling preset is a
     length. This string appears on nine surfaces. */
  it("describes an explicit range by its dates, not a length", () => {
    const f = analyticsFilterFrom(
      scope({ range: "custom", from: "2026-08-01", to: "2026-08-10" }),
      NOW,
    );
    // `to` is exclusive, so the last day IN the window is Aug 10.
    expect(describeWindow(f)).toBe("Aug 1, 2026 to Aug 10, 2026");
    expect(describeWindow(f)).not.toMatch(/last \d+ days/);
  });

  it("describes a half-open explicit range honestly", () => {
    const openEnd = analyticsFilterFrom(
      scope({ range: "custom", from: "2026-08-01" }),
      NOW,
    );
    expect(describeWindow(openEnd)).toBe("since Aug 1, 2026");

    const openStart = analyticsFilterFrom(
      scope({ range: "custom", to: "2026-08-10" }),
      NOW,
    );
    expect(describeWindow(openStart)).toBe("up to Aug 10, 2026");
    /* And never "all time": that window IS bounded above. */
    expect(describeWindow(openStart)).not.toBe("all time");
  });

  /* A January range read in September must not claim to be recent. */
  it("does not describe a distant range as recent", () => {
    const f = analyticsFilterFrom(
      scope({ range: "custom", from: "2026-01-01", to: "2026-01-31" }),
      NOW,
    );
    expect(describeWindow(f)).toContain("Jan");
    expect(describeWindow(f)).not.toMatch(/last/);
  });
});

describe("windowDays", () => {
  it("is zero for an unbounded window", () => {
    expect(windowDays(null, null, NOW)).toBe(0);
  });

  /* Never zero for a bounded one: the length divides the comparison period. */
  it("floors a sub-day window at one", () => {
    const from = new Date(NOW.getTime() - 3600_000);
    expect(windowDays(from, NOW, NOW)).toBe(1);
  });

  it("measures to now when there is no upper bound", () => {
    const from = new Date(NOW.getTime() - 5 * 86_400_000);
    expect(windowDays(from, null, NOW)).toBe(5);
  });
});
