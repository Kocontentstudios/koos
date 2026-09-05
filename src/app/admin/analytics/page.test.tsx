import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ dbUser: { id: "a1", role: "admin" } }),
}));
vi.mock("nuqs", () => ({
  useQueryStates: () => [{ range: "30d", from: "", to: "", page: 1 }, vi.fn()],
}));

const q = {
  usage: vi.fn(),
  signups: vi.fn(),
  tickets: vi.fn(),
  brandOptions: vi.fn(),
};

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";

vi.mock("@/lib/db/queries", () => ({
  getUsageEvents: (...a: unknown[]) => q.usage(...a),
  getSignups: (...a: unknown[]) => q.signups(...a),
  getTickets: (...a: unknown[]) => q.tickets(...a),
  getActiveBrandCount: async () => 3,
  getTopBrandsByActivity: async () => [
    { brandId: BRAND, name: "Acme Co", count: 9 },
  ],
  getApprovalDurations: async () => [86_400_000],
  getBrandFilterOptions: (...a: unknown[]) => q.brandOptions(...a),
  countActiveBrandOptions: async () => 40,
}));

import { loadAdminScope } from "@/lib/admin/scope-params";
import AdminAnalyticsPage, { trendBucketDays } from "./page";

const DAY = 86_400_000;
const NOW = Date.now();

beforeEach(() => {
  for (const fn of Object.values(q)) fn.mockReset();
  /* Several kinds so the By-type panel has more than one row — with a single
     kind, "each row narrows to its own kind" cannot fail. */
  const KINDS = [
    "design_generated",
    "calendar_generated",
    "strategy_generated",
    "design_ticket_created",
  ];
  q.usage.mockResolvedValue(
    Array.from({ length: 8 }, (_, i) => ({
      kind: KINDS[i % KINDS.length],
      brandId: BRAND,
      createdAt: new Date(NOW - i * DAY),
    })),
  );
  q.signups.mockResolvedValue([{ createdAt: new Date(NOW - DAY) }]);
  q.tickets.mockResolvedValue([{ createdAt: new Date(NOW - DAY) }]);
  q.brandOptions.mockResolvedValue([{ id: BRAND, name: "Acme Co", count: 9 }]);
});

const renderPage = async (params: Record<string, string> = {}) =>
  render(await AdminAnalyticsPage({ searchParams: Promise.resolve(params) }));

const hrefFor = (label: RegExp) =>
  screen
    .getAllByRole("link")
    .find((a) => label.test(a.textContent ?? ""))
    ?.getAttribute("href") ?? "";

/* Scoped to the records route: an activity-type CHIP and a By-type ROW carry
   the same label, and the chip's href also names the kind — so `find` on the
   label alone returned the chip and the row's own patch went unasserted. */
const recordsHrefFor = (label: RegExp) =>
  screen
    .getAllByRole("link")
    .find(
      (a) =>
        label.test(a.textContent ?? "") &&
        (a.getAttribute("href") ?? "").includes("/records"),
    )
    ?.getAttribute("href") ?? "";

/* Through the parser, not by substring: the serializer drops a value equal to
   its default, so the Generations card correctly links without `metric=`. */
const metricOf = (label: RegExp) =>
  loadAdminScope(new URLSearchParams(hrefFor(label).split("?")[1] ?? ""))
    .metric;

/* The default view used to be range=all, which issued six unbounded table
   reads on every load — a straight scale regression against dev, where every
   fetch was bounded. */
describe("the default view is bounded", () => {
  /* The bare URL redirects rather than silently overriding: `?range=all` and
     no range param are indistinguishable after parsing, so overriding would
     ignore an operator who explicitly chose All time. */
  it("redirects the bare URL to a stated default", async () => {
    // Next's redirect() throws NEXT_REDIRECT; the destination is asserted by
    // the queries never running.
    await expect(renderPage()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(q.usage).not.toHaveBeenCalled();
  });

  it("windows the queries once the range is stated", async () => {
    await renderPage({ range: "30d" });
    const filter = q.usage.mock.calls[0]?.[0] as { from: Date | null };
    expect(filter.from).toBeInstanceOf(Date);
  });

  it("honours an explicit all-time choice", async () => {
    await renderPage({ range: "all" });
    const filter = q.usage.mock.calls[0]?.[0] as { from: Date | null };
    expect(filter.from).toBeNull();
  });
});

describe("each card opens its own metric", () => {
  it.each([
    [/Generations/, "generations"],
    [/Active brands/, "brands"],
    [/New users/, "users"],
    [/Tickets/, "tickets"],
    [/Time to approval/, "approvals"],
  ])("%s", async (label, metric) => {
    await renderPage({ range: "30d" });
    expect(metricOf(label)).toBe(metric);
  });

  it("gives each card a different metric", async () => {
    await renderPage({ range: "30d" });
    const metrics = [
      /Generations/,
      /Active brands/,
      /New users/,
      /Tickets/,
      /Time to approval/,
    ].map(metricOf);
    expect(new Set(metrics).size).toBe(5);
  });
});

/* FEAT-007: "make sure the selected Analytics filters remain applied". */
describe("a By-type row carries the filter and adds its own kind", () => {
  it("keeps the range and brand while patching the kind", async () => {
    await renderPage({ range: "30d", brand: BRAND });
    const href = recordsHrefFor(/Design image/);
    expect(href).toContain("kind=design_generated");
    expect(href).toContain("range=30d");
    expect(href).toContain(`brand=${BRAND}`);
  });

  it("points a brand row at that brand's records", async () => {
    await renderPage({ range: "30d" });
    expect(recordsHrefFor(/Acme Co/)).toContain(`brand=${BRAND}`);
  });

  /* Each row must narrow to its OWN kind. Dropping the patch makes every row
     open the same unfiltered list while still looking like a drill-down. */
  it("gives each By-type row a different kind", async () => {
    await renderPage({ range: "30d" });
    const kinds = [/Design image/, /Calendar/, /Strategy/, /Design ticket/]
      .map((l) => recordsHrefFor(l).match(/kind=(\w+)/)?.[1])
      .filter(Boolean);
    expect(kinds.length).toBeGreaterThan(1);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});

/* These render with a filter already applied, because the panel starts closed
   on an unfiltered view — by design, so four groups do not push the numbers
   they filter below the fold. The previous version of these tests passed only
   because the default view wrongly reported "1 filter applied" and opened the
   panel; fixing that exposed the dependency. */
describe("the filter chips", () => {
  it("toggles a selected activity type off again", async () => {
    await renderPage({ range: "30d", kind: "design_generated" });
    // The chip for an active kind must remove it, not re-add it.
    expect(hrefFor(/^Design image$/)).not.toContain("kind=design_generated");
  });

  it("adds an unselected activity type", async () => {
    await renderPage({ range: "7d" });
    expect(hrefFor(/^Design image$/)).toContain("kind=design_generated");
  });

  it("offers a ticket status group", async () => {
    await renderPage({ range: "7d" });
    expect(hrefFor(/Approved/)).toContain("status=");
  });

  /* FEAT-005 asks to filter by "most active brand". Ordering by name and
     slicing made the busiest brand unselectable when its name sorted late. */
  it("asks for brands by activity within the current window", async () => {
    await renderPage({ range: "7d" });
    expect(q.brandOptions).toHaveBeenCalled();
    const arg = q.brandOptions.mock.calls[0]?.[0] as { from: Date | null };
    expect(arg.from).toBeInstanceOf(Date);
  });

  it("says when the brand list is a top slice", async () => {
    await renderPage({ range: "7d" });
    // The legend is rendered twice: once sr-only, once visible.
    expect(screen.getAllByText(/top 1 of 40/i).length).toBeGreaterThan(0);
  });
});

describe("captions tell the truth about the window", () => {
  it("names a preset by its length", async () => {
    await renderPage({ range: "7d" });
    expect(screen.getAllByText(/last 7 days/i).length).toBeGreaterThan(0);
  });

  /* The regression: a January range read in September said "last 31 days". */
  it("names an explicit range by its dates", async () => {
    await renderPage({ range: "custom", from: "2026-01-01", to: "2026-01-31" });
    expect(
      screen.getAllByText(/Jan 1, 2026 to Jan 31, 2026/).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/last 31 days/i)).not.toBeInTheDocument();
  });
});

/* A signup belongs to no brand, so the brand filter cannot narrow this card.
   Leaving it silent puts an unnarrowed number under a "filters applied" badge. */
describe("New users says the brand filter does not reach it", () => {
  it("marks the card when a brand is selected", async () => {
    await renderPage({ range: "30d", brand: BRAND });
    expect(screen.getByText(/all brands/i)).toBeInTheDocument();
  });

  it("says nothing extra when no such filter is on", async () => {
    await renderPage({ range: "30d" });
    expect(screen.queryByText(/all brands/i)).not.toBeInTheDocument();
  });

  it("does not pass the brand to the signup query", async () => {
    await renderPage({ range: "30d", brand: BRAND });
    const filter = q.signups.mock.calls[0]?.[0] as { brandId: string | null };
    // The filter object carries it; the query is what must ignore it.
    expect(filter.brandId).toBe(BRAND);
  });
});

/* The chart sits directly under the card it is a breakdown of, so the bars must
   cover the same window. Clamping truncated a 90-day selection to 84 days of
   bars under a card reading 90, and a floor of two buckets gave "last 7 days"
   one full bar beside a permanently empty one. */
describe("the chart covers the window the card counts", () => {
  it.each([
    ["7d", 7],
    ["30d", 30],
    ["90d", 90],
  ])("%s renders enough bars to span the window", async (range, days) => {
    await renderPage({ range });
    const bars = document.querySelectorAll("[data-trend-bar]").length;
    expect(bars).toBeGreaterThan(1);
    expect(bars * trendBucketDays(days)).toBeGreaterThanOrEqual(days);
  });

  it("never renders a single bar for a multi-day window", async () => {
    await renderPage({ range: "7d" });
    expect(document.querySelectorAll("[data-trend-bar]").length).toBe(7);
  });
});

/* The delta drives a number, an arrow and a colour on three cards. Swapping
   its arguments turns a genuine +100% into a red -50% and used to be invisible. */
describe("the change against the previous period", () => {
  const growth = async (currentCount: number, previousCount: number) => {
    q.usage.mockImplementation(async (f: { from: Date | null }) => {
      // previousWindow shifts `from` back by the window's own length.
      const isPrevious = f.from !== null && f.from.getTime() < NOW - 30 * DAY;
      const n = isPrevious ? previousCount : currentCount;
      return Array.from({ length: n }, () => ({
        kind: "design_generated",
        brandId: BRAND,
        createdAt: new Date(NOW - DAY),
      }));
    });
    await renderPage({ range: "30d" });
    return (
      screen
        .getAllByRole("link")
        .find((a) => /Generations/.test(a.textContent ?? ""))?.textContent ?? ""
    );
  };

  it("reports growth as growth", async () => {
    expect(await growth(20, 10)).toMatch(/↑\s*100%/);
  });

  it("reports a decline as a decline", async () => {
    expect(await growth(10, 20)).toMatch(/↓\s*50%/);
  });

  it("does not invert the direction", async () => {
    const up = await growth(20, 10);
    expect(up).not.toMatch(/↓/);
  });

  /* All time has no previous period; inventing one puts a percentage on a card
     that cannot have a meaningful comparison. */
  it("shows no delta for an unbounded range", async () => {
    await renderPage({ range: "all" });
    const card =
      screen
        .getAllByRole("link")
        .find((a) => /Generations/.test(a.textContent ?? ""))?.textContent ??
      "";
    expect(card).not.toMatch(/[↑↓]/);
  });
});

describe("All time is reachable", () => {
  /* `all` equals the parser default, so the serializer drops it and the chip
     linked to the bare URL — which the redirect sent straight back to 30 days.
     The redirect was introduced so an explicit choice would NOT be ignored. */
  it("forces the range into the chip's URL", async () => {
    await renderPage({ range: "7d" });
    const chip = screen
      .getAllByRole("link")
      .find((a) => (a.textContent ?? "").trim() === "All time");
    expect(chip?.getAttribute("href")).toContain("range=all");
  });

  it("does not redirect away from an explicit all-time choice", async () => {
    await renderPage({ range: "all" });
    const filter = q.usage.mock.calls[0]?.[0] as { from: Date | null };
    expect(filter.from).toBeNull();
  });

  /* A blank or malformed value parses to the default and must still be bounded
     — that is the scale regression the redirect exists to prevent. */
  it.each(["", "30", "zzz"])("redirects a %s range", async (range) => {
    await expect(renderPage({ range })).rejects.toThrow(/NEXT_REDIRECT/);
    expect(q.usage).not.toHaveBeenCalled();
  });
});

describe("the default view does not claim to be filtered", () => {
  it("reports no filters applied", async () => {
    await renderPage({ range: "30d" });
    expect(screen.queryByText(/filter applied/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/filters applied/i)).not.toBeInTheDocument();
  });

  it("keeps the panel closed", async () => {
    await renderPage({ range: "30d" });
    expect(screen.getByRole("button", { name: /^filter$/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("counts a real filter", async () => {
    await renderPage({ range: "7d" });
    expect(screen.getByText(/1 filter applied/i)).toBeInTheDocument();
  });
});

/* FEAT-005 names its date options verbatim. Deleting the group, or dropping one
   option, left the suite green — the chip tests only asserted the options they
   happened to look for. */
describe("every date option the ticket names", () => {
  it.each([
    "Last 7 days",
    "Last 15 days",
    "Last 30 days",
    "Last 90 days",
    "All time",
  ])("offers %s", async (label) => {
    await renderPage({ range: "7d" });
    expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
  });

  it("groups them under a date-range legend", async () => {
    await renderPage({ range: "7d" });
    expect(screen.getAllByText("Date range").length).toBeGreaterThan(0);
  });

  /* The fourth option is a form, not a chip. */
  it("offers a custom range form", async () => {
    await renderPage({ range: "7d" });
    expect(screen.getByLabelText(/^from$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^to$/i)).toBeInTheDocument();
  });

  it("offers every activity type and a ticket status group", async () => {
    await renderPage({ range: "7d" });
    expect(screen.getAllByText("Activity type").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ticket status").length).toBeGreaterThan(0);
  });
});

/* The chart ends where the window ends, not at today: a custom range finishing
   in January would otherwise draw its bars up to now, and the bars would stop
   lining up with the card. */
describe("the chart ends where the window does", () => {
  it("uses the window's own end for an explicit range", async () => {
    // Events INSIDE the selected month, or the panel renders its empty state.
    q.usage.mockResolvedValue([
      {
        kind: "design_generated",
        brandId: BRAND,
        createdAt: new Date("2026-01-15T12:00:00Z"),
      },
      {
        kind: "calendar_generated",
        brandId: BRAND,
        createdAt: new Date("2026-01-20T12:00:00Z"),
      },
    ]);
    await renderPage({ range: "custom", from: "2026-01-01", to: "2026-01-31" });
    const labels = Array.from(
      document.querySelectorAll("[data-trend-bar]"),
    ).map((b) => b.getAttribute("title") ?? "");
    // Every bucket label must fall inside the selected month, not in September.
    expect(labels.join(" ")).toMatch(/Jan|Feb/);
    expect(labels.join(" ")).not.toMatch(/Sep/);
  });
});
