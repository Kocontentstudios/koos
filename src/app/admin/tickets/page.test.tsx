import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const BRAND = "83f0fe91-9dad-4385-861f-39dc078a7210";
const TOLU = "11111111-1111-1111-1111-111111111111";

const { viewerRole } = vi.hoisted(() => ({ viewerRole: { current: "admin" } }));

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ dbUser: { id: "a1", role: viewerRole.current } }),
}));

vi.mock("nuqs", () => ({
  useQueryStates: () => [{ q: "", page: 1 }, vi.fn()],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const listAdminTickets = vi.fn();
const countAdminTickets = vi.fn();

/* Cleared between tests. Without this, `countAdminTickets.mock.calls.find(...)`
   reads a call left behind by an EARLIER test, so the badge-scope assertion
   below passed against a stale scope and could not fail. */
beforeEach(() => {
  listAdminTickets.mockClear();
  countAdminTickets.mockClear();
  viewerRole.current = "admin";
});

vi.mock("@/lib/db/queries", () => ({
  listAdminTickets: (...a: unknown[]) => listAdminTickets(...a),
  countAdminTickets: (...a: unknown[]) => countAdminTickets(...a),
  getStaffUsers: async () => [
    {
      id: TOLU,
      firstName: "Tolu",
      lastName: "Adeyemi",
      email: "tolu@koos.test",
      role: "designer",
    },
  ],
  getUserById: async () => ({
    id: TOLU,
    firstName: "Tolu",
    lastName: "Adeyemi",
    email: "tolu@koos.test",
  }),
  getWorkloadForDesigner: async () => ({ active: 1, overdue: 1 }),
}));

import AdminTicketsPage from "./page";

const NOW = new Date();
const DAY = 24 * 60 * 60 * 1000;

function ticket(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    ticketNumber: 12,
    title: "A ticket",
    designType: "Flyer",
    dimensions: null,
    slides: null,
    brief: "Do the thing",
    status: "submitted",
    priority: "normal",
    dueDate: null,
    createdAt: NOW,
    updatedAt: NOW,
    approvedAt: null,
    brandId: BRAND,
    brandName: "Acme Co",
    campaignName: null,
    itemTitle: null,
    requesterId: "u1",
    requesterEmail: "client@koos.test",
    designerId: null,
    designerFirstName: null,
    designerLastName: null,
    designerEmail: null,
    ...over,
  };
}

async function renderPage(
  params: Record<string, string> = {},
  rows: ReturnType<typeof ticket>[] = [ticket()],
  total = rows.length,
) {
  listAdminTickets.mockResolvedValue(rows);
  countAdminTickets.mockResolvedValue(total);
  render(await AdminTicketsPage({ searchParams: Promise.resolve(params) }));
}

/* Scoped to the row: "Overdue" is also a tab label and "Unassigned" is also an
   option in the assign dropdown, so a document-wide query catches chrome. */
function rowText(): string {
  return document.querySelector("ul > li")?.textContent ?? "";
}

/* Matched on leading text, not the full accessible name: a tab carrying a
   count badge reads as "Needs revision1". */
function tabHref(label: string): string {
  const link = screen
    .getAllByRole("link")
    .find((a) => (a.textContent ?? "").startsWith(label));
  return link?.getAttribute("href") ?? "MISSING";
}

/* This page had no test file, which is how a status filter survived a tab
   click into an unsatisfiable AND and two drill-downs arrived with nothing on
   screen saying what they were. */
describe("the page says what it is showing", () => {
  it("names the view when no tab can represent it", async () => {
    await renderPage({ view: "approved" });
    expect(screen.getByText(/Approved work/)).toBeInTheDocument();
  });

  it("names the designer drill-down's view too", async () => {
    await renderPage({ view: "active", assignee: TOLU });
    expect(screen.getByText(/Active work/)).toBeInTheDocument();
  });

  it("names the status when the list is filtered to one", async () => {
    await renderPage({ view: "all", status: "delivered" });
    expect(screen.getByText(/status: Approved/)).toBeInTheDocument();
  });

  it("names the search term", async () => {
    await renderPage({ q: "logo" });
    expect(screen.getByText(/matching "logo"/)).toBeInTheDocument();
  });
});

describe("changing tabs cannot produce an impossible filter", () => {
  /* The blocker: tabs carried `status` forward, so arriving from the Approved
     status row and clicking Open gave `NOT IN (draft, delivered) AND
     = delivered` — zero rows under "The queue is empty. Nice work." while
     dozens of open tickets existed. */
  it("clears the status filter when switching view", async () => {
    await renderPage({ view: "all", status: "delivered" });
    for (const label of ["Open", "Overdue", "All", "In progress"]) {
      expect(tabHref(label)).not.toContain("status=");
    }
  });

  /* Brand and assignee are orthogonal to the view and must still ride along —
     that is the whole point of the shared scope. */
  it("keeps the filters that are orthogonal to the view", async () => {
    await renderPage({ view: "all", assignee: TOLU, brand: BRAND });
    expect(tabHref("Overdue")).toContain(`assignee=${TOLU}`);
    expect(tabHref("Overdue")).toContain(`brand=${BRAND}`);
  });

  /* The badge on a tab must be counted under exactly what that tab's href
     opens. Keeping scope.status counted `revision_requested AND draft` — zero,
     so the badge vanished — and then the click opened the full revision list. */
  it("counts the needs-revision badge under the scope its own tab opens", async () => {
    await renderPage({ view: "all", status: "draft" });
    const badgeCall = countAdminTickets.mock.calls.find(
      (c) => (c[0] as { view: string }).view === "needs_revision",
    );
    expect(badgeCall?.[0]).toMatchObject({
      view: "needs_revision",
      status: [],
      page: 1,
    });
    expect(tabHref("Needs revision")).not.toContain("status=");
  });

  it("returns to the first page on a view change", async () => {
    await renderPage({ view: "all", page: "3" });
    expect(tabHref("Overdue")).not.toContain("page=");
  });
});

describe("row actions are gated by what the ticket is", () => {
  /* The regression: dev restricted this page to four statuses, so the action
     block never had to ask. Driving it from the URL put drafts and signed-off
     work on the same page — and Start on an approved ticket reopens it and
     emails the client about work they already accepted. */
  it("offers nothing actionable on a client's unsubmitted draft", async () => {
    await renderPage({ view: "all", status: "draft" }, [
      ticket({ status: "draft" }),
    ]);
    for (const name of [/claim/i, /^start$/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/upload deliverables/i)).not.toBeInTheDocument();
  });

  it("offers nothing actionable on approved work", async () => {
    await renderPage({ view: "approved" }, [
      ticket({ status: "delivered", approvedAt: NOW }),
    ]);
    expect(screen.queryByRole("button", { name: /^start$/i })).toBeNull();
    expect(screen.queryByText(/upload deliverables/i)).toBeNull();
  });

  it("still offers the full set on live work", async () => {
    await renderPage({ view: "open" }, [ticket({ status: "submitted" })]);
    expect(screen.getByRole("button", { name: /claim/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^start$/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/upload deliverables/i)).toBeInTheDocument();
  });

  /* Every row keeps View / update: reading a ticket is always allowed, it is
     only writing to one that depends on its state. */
  it("always allows opening the ticket", async () => {
    await renderPage({ view: "all", status: "draft" }, [
      ticket({ status: "draft" }),
    ]);
    expect(
      screen.getByRole("link", { name: /view \/ update/i }),
    ).toBeInTheDocument();
  });
});

describe("the lateness chip agrees with the overdue count", () => {
  const past = new Date(NOW.getTime() - 9 * DAY);

  it("does not claim a draft is overdue", async () => {
    await renderPage({ view: "all", status: "draft" }, [
      ticket({ status: "draft", dueDate: past }),
    ]);
    expect(rowText()).not.toMatch(/overdue/i);
  });

  it("marks live work that is past its date", async () => {
    await renderPage({ view: "overdue" }, [
      ticket({ status: "in_progress", dueDate: past }),
    ]);
    expect(rowText()).toMatch(/9 days overdue/);
  });
});

describe("the assignee is named, never mislabelled", () => {
  /* first_name is NOT NULL but may be empty, so a real designer can render as
     "". The row used to read "Unassigned" while genuinely assigned. */
  it("falls back to the email for a designer with no name", async () => {
    await renderPage({ view: "open" }, [
      ticket({
        designerId: TOLU,
        designerFirstName: "",
        designerLastName: "",
        designerEmail: "nameless@koos.test",
      }),
    ]);
    expect(screen.getByText("nameless@koos.test")).toBeInTheDocument();
    expect(document.querySelector("ul > li p")?.textContent).not.toBe(
      "Unassigned",
    );
  });
});

describe("paging", () => {
  it("offers a way past the first page", async () => {
    await renderPage({ view: "all" }, [ticket()], 137);
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /next/i }).getAttribute("href"),
    ).toContain("page=2");
  });

  /* The empty state must not claim the queue is clear when the operator has
     simply walked off the end of it. */
  it("says the page is past the end rather than that nothing matched", async () => {
    await renderPage({ view: "open", page: "99" }, [], 137);
    expect(screen.getByText(/past the end/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nice work/)).not.toBeInTheDocument();
  });

  it("steps back to the last real page from past the end", async () => {
    await renderPage({ view: "all", page: "99" }, [], 137);
    expect(
      screen.getByRole("link", { name: /previous/i }).getAttribute("href"),
    ).toContain("page=3");
  });
});

/* Scoped to the header: the designer's name also appears in every row's assign
   dropdown, so a document-wide query cannot tell the two apart. */
function headerText(): string {
  const el = document.querySelector("div.rounded-xl.border");
  return el?.textContent ?? "";
}

describe("the designer drill-down header", () => {
  /* BUG-001 asks for "assigned tickets AND workload". Returning null made the
     page a filtered table that never names whose list it is. */
  it("appears when the list is scoped to a designer", async () => {
    await renderPage({ view: "active", assignee: TOLU });
    expect(headerText()).toContain("Tolu Adeyemi");
    expect(headerText()).toContain("1 active");
    expect(headerText()).toContain("1 overdue");
  });

  it("does not appear on an unscoped list", async () => {
    await renderPage({ view: "open" });
    expect(headerText()).not.toContain("active");
  });

  /* `unassigned` is a sentinel meaning "no designer", not a designer id.
     Looking it up would query for a user whose id is the string "unassigned". */
  it("does not treat the unassigned sentinel as a person", async () => {
    await renderPage({ view: "open", assignee: "unassigned" });
    expect(headerText()).not.toContain("Tolu Adeyemi");
  });
});

describe("what each view says when it is empty", () => {
  /* An operator who opened Overdue and sees "The queue is empty. Nice work."
     has been told the wrong thing about the wrong list. */
  it.each([
    ["overdue", /nothing is overdue/i],
    ["open", /queue is empty/i],
    ["needs_revision", /no revisions requested/i],
    ["awaiting_review", /nothing is waiting on a client/i],
  ])("%s", async (view, expected) => {
    await renderPage({ view }, [], 0);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("gives each view a distinct message", async () => {
    const seen = new Set<string>();
    for (const view of [
      "overdue",
      "open",
      "needs_revision",
      "awaiting_review",
    ]) {
      cleanup();
      await renderPage({ view }, [], 0);
      const el = document.querySelector("p.rounded-xl");
      seen.add(el?.textContent ?? "");
    }
    expect(seen.size).toBe(4);
  });
});

describe("the View link opens the ticket, not the list", () => {
  it("addresses the row's own id", async () => {
    await renderPage({ view: "open" }, [ticket({ id: "tk-77" })]);
    expect(
      screen
        .getByRole("link", { name: /view \/ update/i })
        .getAttribute("href"),
    ).toBe("/admin/tickets/tk-77");
  });
});

describe("reassignment is offered only to someone who can complete it", () => {
  /* /manage is admin-only, so offering the control to a designer is an action
     that can only fail. requireRole is mocked as an admin here; the designer
     case is covered in queue-client.test.tsx via canAssign. */
  it("renders the roster for an admin on live work", async () => {
    await renderPage({ view: "open" }, [ticket({ status: "submitted" })]);
    expect(
      screen.getByRole("combobox", { name: /assign/i }),
    ).toBeInTheDocument();
  });

  /* /manage returns 403 for a designer, so rendering the roster for one offers
     an action that can only fail. */
  it("hides the roster from a designer", async () => {
    viewerRole.current = "designer";
    await renderPage({ view: "open" }, [ticket({ status: "submitted" })]);
    expect(screen.queryByRole("combobox", { name: /assign/i })).toBeNull();
  });

  /* And does not spend a query fetching a roster it will not render. */
  it("does not load the roster for a designer", async () => {
    viewerRole.current = "designer";
    await renderPage({ view: "open" });
    expect(screen.queryByRole("option")).toBeNull();
  });

  /* The assign control is a write to the client's ticket like any other, and
     a draft is the client's own unsubmitted request. */
  it("does not render it on a draft or on signed-off work", async () => {
    await renderPage({ view: "all", status: "draft" }, [
      ticket({ status: "draft" }),
    ]);
    expect(screen.queryByRole("combobox", { name: /assign/i })).toBeNull();

    cleanup();
    await renderPage({ view: "approved" }, [
      ticket({ status: "delivered", approvedAt: NOW }),
    ]);
    expect(screen.queryByRole("combobox", { name: /assign/i })).toBeNull();
  });
});
