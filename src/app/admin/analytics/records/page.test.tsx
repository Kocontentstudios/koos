import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ dbUser: { id: "a1", role: "admin" } }),
}));

const calls = {
  generations: vi.fn(),
  users: vi.fn(),
  tickets: vi.fn(),
  approvals: vi.fn(),
  brands: vi.fn(),
  campaigns: vi.fn(),
  calendar: vi.fn(),
  deliveries: vi.fn(),
  revisions: vi.fn(),
  brandSetup: vi.fn(),
};

vi.mock("@/lib/db/queries", () => ({
  listGenerationRecords: (...a: unknown[]) => calls.generations(...a),
  countGenerationRecords: async () => 3,
  listUserRecords: (...a: unknown[]) => calls.users(...a),
  countUserRecords: async () => 3,
  listTicketRecords: (...a: unknown[]) => calls.tickets(...a),
  countTicketRecords: async () => 3,
  listApprovalRecords: (...a: unknown[]) => calls.approvals(...a),
  countApprovalRecords: async () => 3,
  listBrandRecords: (...a: unknown[]) => calls.brands(...a),
  countBrandRecords: async () => 3,
  listCampaignRecords: (...a: unknown[]) => calls.campaigns(...a),
  countCampaignRecords: async () => 3,
  listCalendarRecords: (...a: unknown[]) => calls.calendar(...a),
  countCalendarRecords: async () => 3,
  listDeliveryRecords: (...a: unknown[]) => calls.deliveries(...a),
  countDeliveryRecords: async () => 3,
  listRevisionRecords: (...a: unknown[]) => calls.revisions(...a),
  countRevisionRecords: async () => 3,
  listBrandSetupRecords: (...a: unknown[]) => calls.brandSetup(...a),
  countBrandSetupRecords: async () => 3,
}));

import { RECORD_KINDS } from "@/lib/analytics/records";
import { brandProfileCompletion } from "@/lib/brand-profile";
import AnalyticsRecordsPage from "./page";

const WHEN = new Date("2026-08-24T12:00:00Z");

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset();
  calls.generations.mockResolvedValue([
    {
      id: "g1",
      kind: "design_generated",
      createdAt: WHEN,
      brandId: "b1",
      brandName: "Acme Co",
      userEmail: "c@k",
      userFirstName: "Cara",
      userLastName: "Client",
    },
  ]);
  calls.users.mockResolvedValue([
    {
      id: "u1",
      email: "c@k",
      firstName: "Cara",
      lastName: "Client",
      role: "user",
      createdAt: WHEN,
    },
  ]);
  calls.tickets.mockResolvedValue([
    {
      id: "t1",
      ticketNumber: 73,
      title: "Signed off",
      designType: "Brochure",
      status: "delivered",
      createdAt: WHEN,
      brandName: "Acme Co",
    },
  ]);
  calls.approvals.mockResolvedValue([
    {
      id: "t1",
      ticketNumber: 73,
      title: "Signed off",
      designType: "Brochure",
      createdAt: WHEN,
      deliveredAt: WHEN,
      approvedAt: WHEN,
      brandName: "Acme Co",
      designerFirstName: "Bimpe",
      designerLastName: "Okafor",
      designerEmail: "b@k",
    },
  ]);
  calls.campaigns.mockResolvedValue([
    {
      id: "s1",
      name: "Harmattan launch",
      status: "active",
      createdAt: WHEN,
      brandId: "b1",
      brandName: "Acme Co",
    },
  ]);
  calls.calendar.mockResolvedValue([
    {
      id: "ci1",
      title: "Launch teaser",
      platform: "Instagram",
      status: "ready",
      source: "ai",
      date: WHEN,
      createdAt: WHEN,
      brandName: "Acme Co",
    },
  ]);
  calls.deliveries.mockResolvedValue([
    {
      id: "t1",
      ticketNumber: 73,
      title: "Signed off",
      designType: "Brochure",
      status: "delivered",
      deliveredAt: WHEN,
      approvedAt: WHEN,
      brandName: "Acme Co",
    },
    {
      id: "t2",
      ticketNumber: 74,
      title: "Still out",
      designType: "Flyer",
      status: "ready_for_review",
      deliveredAt: WHEN,
      approvedAt: null,
      brandName: "Acme Co",
    },
  ]);
  calls.revisions.mockResolvedValue([
    {
      id: "u1",
      ticketId: "t1",
      ticketNumber: 73,
      title: "Signed off",
      designType: "Brochure",
      message: "Please make the logo larger and swap the background colour.",
      createdAt: WHEN,
      brandName: "Acme Co",
    },
  ]);
  calls.brandSetup.mockResolvedValue([
    {
      id: "b1",
      name: "Acme Co",
      onboardingStatus: "in_progress",
      createdAt: WHEN,
      primaryColor: "#101010",
    },
  ]);
  calls.brands.mockResolvedValue([
    {
      brandId: "b1",
      name: "Acme Co",
      ownerEmail: "c@k",
      ownerFirstName: "Cara",
      ownerLastName: "Client",
      lastActiveAt: WHEN,
      count: 9,
    },
  ]);
});

const renderPage = async (params: Record<string, string> = {}) =>
  render(await AnalyticsRecordsPage({ searchParams: Promise.resolve(params) }));

const headers = () =>
  Array.from(document.querySelectorAll("th")).map((t) => t.textContent);

/* The bug this exists to stop: `metric=tickets` had no case in the switch and
   fell through to generations, so the page rendered the generation table under
   a "Tickets" heading — the label came from RECORD_LABELS and masked it. */
describe("each metric renders its own records", () => {
  it.each([
    ["generations", ["Type", "Brand", "By", "When"]],
    /* FEAT-003 names "brand" on the New Users list; Role was never asked for. */
    ["users", ["Name", "Email", "Brand", "Signed up"]],
    ["tickets", ["Ticket", "Title", "Brand", "Status", "Created"]],
    /* FEAT-003 names "workspace" on the Active Brands list. */
    ["brands", ["Brand", "Owner", "Workspace", "Last active", "Activity"]],
    [
      "approvals",
      [
        "Ticket",
        "Brand",
        "Designer",
        "Requested",
        "Delivered",
        "Approved",
        "Took",
      ],
    ],
  ])("%s", async (metric, columns) => {
    await renderPage({ metric });
    expect(headers()).toEqual(columns);
  });

  it("queries only the metric it was asked for", async () => {
    await renderPage({ metric: "tickets" });
    expect(calls.tickets).toHaveBeenCalled();
    expect(calls.generations).not.toHaveBeenCalled();
  });

  it.each([...RECORD_KINDS])("%s names itself", async (metric) => {
    await renderPage({ metric });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBeTruthy();
    /* Every metric explains what its rows ARE before the columns are read —
       "By type" and "Time to approval" name nothing on their own. */
    const description = document.querySelector("header p")?.textContent ?? "";
    expect(description.length).toBeGreaterThan(30);
    expect(description).toMatch(/Showing/);
  });
});

describe("an unknown metric is data, not a crash", () => {
  it.each(["", "nope", "../etc/passwd"])(
    "falls back for %s",
    async (metric) => {
      await renderPage({ metric });
      expect(headers()).toEqual(["Type", "Brand", "By", "When"]);
    },
  );
});

describe("the window the number came from", () => {
  it("says which one it is", async () => {
    await renderPage({ metric: "users", range: "30d" });
    expect(document.querySelector("header p")?.textContent).toMatch(
      /last 30 days/,
    );
  });

  it("reaches the query", async () => {
    await renderPage({ metric: "users", range: "7d" });
    const filter = calls.users.mock.calls[0]?.[0] as { from: Date | null };
    expect(filter.from).toBeInstanceOf(Date);
  });

  /* FEAT-007: the filters an operator applied must survive the drill-down. */
  it("carries the analytics filter into the query", async () => {
    await renderPage({
      metric: "generations",
      range: "30d",
      kind: "design_generated",
      brand: "3aac081f-cae5-446c-af3a-eaa2dfc3f916",
    });
    const filter = calls.generations.mock.calls[0]?.[0] as {
      kinds: string[];
      brandId: string | null;
    };
    expect(filter.kinds).toEqual(["design_generated"]);
    expect(filter.brandId).toBe("3aac081f-cae5-446c-af3a-eaa2dfc3f916");
  });
});

describe("paging", () => {
  it("offsets by the page it was given", async () => {
    await renderPage({ metric: "users", page: "3" });
    expect(calls.users.mock.calls[0]?.[2]).toBe(100);
  });

  it("returns to analytics without the metric it drilled into", async () => {
    await renderPage({ metric: "users", range: "30d" });
    const back = screen
      .getByRole("link", { name: /back to analytics/i })
      .getAttribute("href");
    expect(back).toContain("/admin/analytics");
    expect(back).toContain("range=30d");
    expect(back).not.toContain("metric=");
  });
});

/* A metric that cannot honour a filter must say so, rather than showing an
   unnarrowed list under a header that implies it was narrowed. */
describe("filters a metric cannot honour are disclosed", () => {
  /* A real uuid: `brand` is validated at the parser, so a placeholder is
     dropped exactly as a hand-edited URL would be. */
  const BRAND_ID = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
  /* Read as text: the sentence is assembled from several nodes, so an
     element-level matcher cannot see it. */
  const headerText = () =>
    Array.from(document.querySelectorAll("header p"))
      .map((p) => p.textContent)
      .join(" ");

  it("says the brand filter does not apply to new users", async () => {
    await renderPage({ metric: "users", brand: BRAND_ID });
    expect(headerText()).toMatch(/brand filter.*does not apply/i);
  });

  it("says nothing when every active filter applies", async () => {
    await renderPage({ metric: "tickets", status: "delivered" });
    expect(headerText()).not.toMatch(/does not apply/i);
  });

  it("names the filters that DO narrow the list", async () => {
    await renderPage({
      metric: "tickets",
      brand: BRAND_ID,
      status: "delivered",
    });
    expect(headerText()).toMatch(/narrowed to/i);
    expect(headerText()).toMatch(/one brand/i);
  });

  /* The activity-type filter is meaningless for tickets and for signups. */
  it("says the activity type filter does not apply to tickets", async () => {
    await renderPage({ metric: "tickets", kind: "design_generated" });
    expect(headerText()).toMatch(/activity type filter.*does not apply/i);
  });
});

/* The same defect already fixed once on the ticket queue: a bookmarked or
   hand-edited ?page=4 that a narrowed filter has pushed past the end renders
   an empty table with NO pager, so there is no way back except editing the
   URL. The pager stays visible past the end precisely so Previous exists. */
describe("a page past the end can still be navigated away from", () => {
  it("keeps the pager when the requested page no longer exists", async () => {
    await renderPage({ metric: "tickets", page: "4" });
    expect(
      screen.getByRole("navigation", { name: "Pagination" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Page 4 of 1")).toBeInTheDocument();
  });

  it("offers a live Previous link, not a disabled one", async () => {
    await renderPage({ metric: "tickets", page: "4" });
    const prev = screen.getByText("← Previous");
    expect(prev.tagName).toBe("A");
    expect(prev).not.toHaveAttribute("aria-disabled");
  });

  /* One page of results needs no pager at all. Without this the guard could be
     satisfied by rendering it unconditionally. */
  it("shows no pager when everything fits on one page", async () => {
    await renderPage({ metric: "tickets" });
    expect(
      screen.queryByRole("navigation", { name: "Pagination" }),
    ).not.toBeInTheDocument();
  });
});

/* ── ADMIN-FEAT-004: the breakdown behind each new card ─────────────────── */

describe("each new metric renders its own columns", () => {
  it.each([
    ["campaigns", ["Campaign", "Brand", "Status", "Created"]],
    [
      "calendar",
      [
        "Entry",
        "Brand",
        "Platform",
        "Scheduled",
        "Status",
        "Author",
        "Created",
      ],
    ],
    [
      "deliveries",
      ["Ticket", "Title", "Brand", "Delivered", "Outcome", "Signed off"],
    ],
    ["revisions", ["Ticket", "Title", "Brand", "What was asked for", "When"]],
    ["brand_setup", ["Brand", "Setup", "Stage", "Created"]],
  ])("%s", async (metric, columns) => {
    await renderPage({ metric });
    expect(headers()).toEqual(columns);
  });
});

/* The rate on the card is the count of this column. If a row cannot say which
   side it fell on, the percentage above it cannot be checked against anything. */
describe("the delivery list shows the outcome the rate counts", () => {
  it("marks an approved delivery and an outstanding one differently", async () => {
    await renderPage({ metric: "deliveries" });
    const cells = Array.from(document.querySelectorAll("td")).map(
      (td) => td.textContent,
    );
    expect(cells).toContain("Approved");
    expect(cells).toContain("Awaiting sign-off");
  });

  /* The date column must not reuse the word the outcome column owns. */
  it("does not head the date column with the outcome's word", async () => {
    await renderPage({ metric: "deliveries" });
    expect(headers()).not.toContain("Approved");
    expect(headers()).toContain("Signed off");
  });
});

describe("the calendar list says how each entry was authored", () => {
  /* The enum stores "ai"; rendered raw it reads as "Ai", and title-cased by the
     ticket humanizer it would collide with a ticket status vocabulary that has
     nothing to do with calendars. */
  it("names the AI author as KO, not the raw enum", async () => {
    await renderPage({ metric: "calendar" });
    expect(screen.getByText("KO")).toBeInTheDocument();
    expect(screen.queryByText("Ai")).toBeNull();
  });

  /* Strategy, calendar and onboarding statuses are separate enums from the
     ticket one, where "delivered" is relabelled "Approved". Borrowing that
     mapping here would rename unrelated values. */
  it("labels a calendar status without the ticket vocabulary", async () => {
    await renderPage({ metric: "calendar" });
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });
});

describe("a revision row is one request, not one ticket", () => {
  it("shows what was actually asked for", async () => {
    await renderPage({ metric: "revisions" });
    expect(screen.getByText(/make the logo larger/i)).toBeInTheDocument();
  });

  /* Free client text of any length otherwise blows the column out and pushes
     every other cell off the row. */
  it("truncates a long message rather than letting it run", async () => {
    calls.revisions.mockResolvedValue([
      {
        id: "u1",
        ticketId: "t1",
        ticketNumber: 73,
        title: "T",
        designType: "Flyer",
        message: "x".repeat(400),
        createdAt: WHEN,
        brandName: "Acme Co",
      },
    ]);
    await renderPage({ metric: "revisions" });
    const cell = screen.getByText(/^x+…$/);
    expect(cell.textContent?.length).toBeLessThanOrEqual(80);
  });
});

describe("brand setup reports the computed completion", () => {
  /* The fixture carries NO completion_percentage column at all, so a card or
     cell reading a stored value would render undefined here. */
  it("renders a percentage computed from the brand's own fields", async () => {
    await renderPage({ metric: "brand_setup" });
    expect(screen.getByText(/^\d+%$/)).toBeInTheDocument();
  });

  it("names the onboarding stage in plain words", async () => {
    await renderPage({ metric: "brand_setup" });
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });
});

/* Every metric must say which of the operator's filters it silently drops. The
   table in records.ts is the single definition; these pin what it means. */
describe("each metric discloses the filters it cannot honour", () => {
  const BRAND_ID2 = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
  const headerText = () =>
    Array.from(document.querySelectorAll("header p"))
      .map((p) => p.textContent)
      .join(" ");

  it.each(["campaigns", "calendar", "deliveries", "revisions", "brand_setup"])(
    "%s says the ticket status filter does not apply",
    async (metric) => {
      await renderPage({ metric, status: "delivered" });
      expect(headerText()).toMatch(/ticket status filter.*does not apply/i);
    },
  );

  it.each(["campaigns", "calendar", "deliveries", "revisions", "brand_setup"])(
    "%s honours the brand filter rather than dropping it",
    async (metric) => {
      await renderPage({ metric, brand: BRAND_ID2 });
      expect(headerText()).toMatch(/narrowed to.*one brand/i);
      expect(headerText()).not.toMatch(/brand filter.*does not apply/i);
    },
  );

  /* Deliberate: the ticket status IS the outcome the rate measures, so
     filtering on it would move numerator and denominator together and pin the
     rate at 100% or 0%. */
  it("says so on the approval rate, where dropping status is a choice", async () => {
    await renderPage({ metric: "deliveries", status: "delivered" });
    expect(headerText()).toMatch(/does not apply to approval rate/i);
  });
});

/* Columns alone do not prove a case fetched its own data: the header array is
   a literal in the case body, so a case calling the WRONG list query renders
   another metric's rows under the right headings and every column assertion
   still passes. Each fixture carries a value only that metric has. */
describe("each metric fetches the rows it names", () => {
  const cells = () =>
    Array.from(document.querySelectorAll("td")).map((td) => td.textContent);

  it.each([
    ["campaigns", "Harmattan launch", "Launch teaser"],
    ["calendar", "Launch teaser", "Harmattan launch"],
    [
      "revisions",
      "Please make the logo larger and swap the background colour.",
      "Harmattan launch",
    ],
  ])("%s shows its own rows and not another's", async (metric, own, other) => {
    await renderPage({ metric });
    const text = cells().join(" | ");
    expect(text).toContain(own.slice(0, 30));
    expect(text).not.toContain(other);
  });

  it("deliveries shows tickets, not calendar entries", async () => {
    await renderPage({ metric: "deliveries" });
    const text = cells().join(" | ");
    expect(text).toContain("Signed off");
    expect(text).not.toContain("Launch teaser");
  });

  it("brand setup shows brands, not tickets", async () => {
    await renderPage({ metric: "brand_setup" });
    const text = cells().join(" | ");
    expect(text).toContain("Acme Co");
    expect(text).not.toContain("Signed off");
  });
});

/* brands.completion_percentage and brandProfileCompletion() disagree, and every
   other surface in the product uses the computed one. The fixture carries NO
   stored column at all, so a cell reading the stored value renders 0% — which
   still matches a loose /\d+%/ assertion. Compared against the function's own
   output, it cannot. */
describe("brand setup completion is computed, not stored", () => {
  const brandRow = {
    id: "b1",
    name: "Acme Co",
    onboardingStatus: "in_progress",
    createdAt: WHEN,
    primaryColor: "#101010",
    industry: "Retail",
    targetAudience: "Lagos homeowners",
  };

  it("renders exactly what brandProfileCompletion returns", async () => {
    calls.brandSetup.mockResolvedValue([brandRow]);
    await renderPage({ metric: "brand_setup" });
    const expected = `${brandProfileCompletion(brandRow)}%`;
    expect(expected).not.toBe("0%");
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("does not fall back to a stored column that is absent", async () => {
    calls.brandSetup.mockResolvedValue([brandRow]);
    await renderPage({ metric: "brand_setup" });
    const cells = Array.from(document.querySelectorAll("td")).map(
      (td) => td.textContent,
    );
    expect(cells).not.toContain("0%");
  });
});

/* The disclosure is a SENTENCE. Capitalising each filter name produced "The
   ticket status filter and The activity type filter" — which only became
   visible once metrics existed that drop two filters at once. */
describe("the disclosure reads as one sentence", () => {
  const headerText = () =>
    Array.from(document.querySelectorAll("header p"))
      .map((p) => p.textContent)
      .join(" ");

  it("capitalises only the start when two filters are dropped", async () => {
    await renderPage({
      metric: "deliveries",
      status: "delivered",
      kind: "design_generated",
    });
    expect(headerText()).toContain(
      "The ticket status filter and the activity type filter do not apply",
    );
    expect(headerText()).not.toContain("and The");
  });

  it("still capitalises a single dropped filter", async () => {
    await renderPage({ metric: "deliveries", status: "delivered" });
    expect(headerText()).toMatch(/The ticket status filter does not apply/);
  });

  it("uses the plural verb for two and the singular for one", async () => {
    await renderPage({
      metric: "deliveries",
      status: "delivered",
      kind: "design_generated",
    });
    expect(headerText()).toContain("filter do not apply");
    await renderPage({ metric: "deliveries", status: "delivered" });
    expect(headerText()).toContain("filter does not apply");
  });
});
