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
}));

import { RECORD_KINDS } from "@/lib/analytics/records";
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
