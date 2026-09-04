import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/* Real uuids: `assignee` is validated at the parser because it is compared
   against a uuid column, so a placeholder id is dropped exactly as a
   hand-edited URL would be. */
const TOLU = "11111111-1111-1111-1111-111111111111";
const NAMELESS = "33333333-3333-3333-3333-333333333333";

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ dbUser: { id: "a1", role: "admin" } }),
}));

/* Every card gets a DIFFERENT number, so an assertion can only pass if the
   card is reading the query that resolves its own predicate. Wiring a card
   back to the status rollup makes these fail. */
const COUNTS = {
  open: 41,
  overdue: 6,
  awaitingReview: 7,
  delivered: 23,
};

/* The Approved STATUS ROW reads the rollup; the Delivered CARD reads its own
   query. They are given different numbers so a card silently falling back to
   the rollup fails here. */
const DELIVERED_ROLLUP = COUNTS.delivered + 5;

vi.mock("@/lib/db/queries", () => ({
  getTicketCountsByStatus: async () => [
    { status: "submitted", count: 11 },
    /* Equal to awaitingReview, and that agreement is the point. A correction
       round sets ready_for_review AND notifies the client, so a re-uploaded
       ticket IS awaiting review — the card and the status row are two routes
       to one answer and must not disagree. */
    { status: "ready_for_review", count: COUNTS.awaitingReview },
    /* Deliberately DIFFERENT from the Delivered card's own count: the card
       must read its own query, not this rollup row. */
    { status: "delivered", count: DELIVERED_ROLLUP },
  ],
  getOpenTicketCount: async () => COUNTS.open,
  getOverdueTicketCount: async () => COUNTS.overdue,
  getAwaitingReviewCount: async () => COUNTS.awaitingReview,
  getApprovedTicketCount: async () => COUNTS.delivered,
  getUserCountsByRole: async () => [{ role: "admin", count: 2 }],
  getDesignerLoads: async () => [
    {
      designerId: TOLU,
      firstName: "Tolu",
      lastName: "A",
      email: "t@k",
      count: 5,
    },
    // first_name is NOT NULL but may be empty. This row used to read "Unknown"
    // on the card while the drill-down header named the same person by email.
    {
      designerId: NAMELESS,
      firstName: "",
      lastName: "",
      email: "nameless@koos.test",
      count: 1,
    },
  ],
  getRecentTickets: async () => [],
}));

import { defaultSortKeyFor, matchesView } from "@/lib/admin/scope";
import { loadAdminScope } from "@/lib/admin/scope-params";
import { TICKET_STATUSES } from "@/lib/design/tickets-ui";
import AdminDashboardPage from "./page";

/* The view a link actually resolves to, not the substring it happens to
   contain: the serializer omits values equal to the default, so the Open card
   correctly links to a bare /admin/tickets. Reading it back through the same
   loader the page uses is the only assertion that survives that. */
function scopeOf(el: HTMLElement) {
  const href = el.getAttribute("href") ?? "";
  return loadAdminScope(new URLSearchParams(href.split("?")[1] ?? ""));
}

async function renderDashboard() {
  render(await AdminDashboardPage());
}

/* Matched on rendered text rather than the accessible name: the pairing under
   test is "which label sits on which number", and comparing the link's own
   text states that without depending on how the a11y name is assembled. */
/* A status row, found by its href rather than its label: the label comes from
   STATUS_LABELS and the point of these assertions is the routing. */
function statusCard(status: string): HTMLElement {
  const found = screen
    .getAllByRole("link")
    .filter((l) => (l.getAttribute("href") ?? "").includes(`status=${status}`));
  if (found.length !== 1) {
    throw new Error(
      `expected one row linking to status=${status}, found ${found.length}`,
    );
  }
  return found[0] as HTMLElement;
}

function card(text: string) {
  const found = screen
    .getAllByRole("link")
    .filter((l) => l.textContent === text);
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one link reading "${text}", found ${found.length} of: ${screen
        .getAllByRole("link")
        .map((l) => l.textContent)
        .join(" | ")}`,
    );
  }
  return found[0] as HTMLElement;
}

describe("every card opens the records behind its own number", () => {
  it("Open tickets", async () => {
    await renderDashboard();
    expect(scopeOf(card(`Open tickets${COUNTS.open}`)).view).toBe("open");
  });

  it("Overdue", async () => {
    await renderDashboard();
    const scope = scopeOf(card(`Overdue${COUNTS.overdue}`));
    expect(scope.view).toBe("overdue");
    /* No explicit sort in the URL: the view's own default already orders
       most-overdue-first, and a redundant param rides the tab bar into views
       that have a different default. */
    expect(scope.sort).toBe("");
    expect(defaultSortKeyFor("overdue")).toBe("overdue");
  });

  /* The exact drift this ticket exists to fix: the card counted the raw
     `ready_for_review` status while the link opened a narrower predicate,
     so clicking 9 showed 7 rows. */
  it("Ready for review counts the same set its link opens", async () => {
    await renderDashboard();
    expect(scopeOf(card(`Ready for review${COUNTS.awaitingReview}`)).view).toBe(
      "awaiting_review",
    );
    // The raw status count, which the card used to show, is a different number.
    expect(
      screen.queryByRole("link", { name: "Ready for review9" }),
    ).toBeNull();
  });

  it("Delivered", async () => {
    await renderDashboard();
    expect(scopeOf(card(`Delivered${COUNTS.delivered}`)).view).toBe("approved");
    /* Reading the rollup row instead of its own query is the fallback this
       guards: the two are deliberately different numbers here. */
    expect(screen.getAllByRole("link").map((l) => l.textContent)).not.toContain(
      `Delivered${DELIVERED_ROLLUP}`,
    );
  });
});

describe("the status overview", () => {
  /* BUG-002 names this label verbatim. */
  it("is labelled the way the ticket asks", async () => {
    await renderDashboard();
    expect(
      screen.getByRole("heading", {
        name: "Dashboard Status Overview (Tickets by Status)",
      }),
    ).toBeInTheDocument();
  });

  it("opens each status it lists", async () => {
    await renderDashboard();
    expect(scopeOf(card("Submitted11")).status).toEqual(["submitted"]);
    /* Both of these used to point at /admin/delivered, a route that does not
       exist on this branch. ADMIN-FEAT-002 re-points them once it does. */
    expect(
      scopeOf(card(`Delivered — Your Review${COUNTS.awaitingReview}`)).status,
    ).toEqual(["ready_for_review"]);
    expect(scopeOf(card(`Approved${DELIVERED_ROLLUP}`)).status).toEqual([
      "delivered",
    ]);
    /* A status row must not inherit the queue's default view, which excludes
       drafts and delivered work — that made these two open an empty list. */
    expect(scopeOf(card(`Approved${DELIVERED_ROLLUP}`)).view).toBe("all");
  });

  /* No dashboard link may point at a segment nobody built. A green test suite
     plus a 404 on the first click is the failure mode this closes. */
  it("never links outside the routes that exist", async () => {
    await renderDashboard();
    for (const link of screen.getAllByRole("link")) {
      const href = link.getAttribute("href") ?? "";
      expect(href.startsWith("/admin/tickets")).toBe(true);
    }
  });
});

describe("designer load", () => {
  it("opens that person's active list", async () => {
    await renderDashboard();
    const scope = scopeOf(card("Tolu A5 active"));
    expect(scope.view).toBe("active");
    expect(scope.assignee).toBe(TOLU);
  });

  /* Naming the same designer two different ways in two places reads as two
     people. Both the card and the drill-down header fall back to the email. */
  it("names a designer with no name on record by their email", async () => {
    await renderDashboard();
    expect(card("nameless@koos.test1 active")).toBeInTheDocument();
  });
});

/**
 * The card's number and the rows its link returns, checked against a fixture
 * table rather than against each other.
 *
 * Every count on this page is mocked, and the query tests derive their SQL
 * expectations FROM `VIEW_PREDICATES` — so widening a predicate mutates both
 * sides and stays green while the Delivered card shows one number and opens a
 * longer list. This resolves each card's href against real ticket shapes and
 * counts the matches independently.
 */
describe("a card's number is the number of rows its link returns", () => {
  const NOW_D = new Date("2026-09-04T12:00:00Z");
  const past = new Date("2026-08-25T12:00:00Z");
  const approved = new Date("2026-08-01T12:00:00Z");

  /* Deliberately includes the shapes that broke earlier rounds: a draft past
     its due date, and work approved then re-opened for a correction. */
  const TICKETS = [
    { status: "draft" as const, approvedAt: null, dueDate: past },
    { status: "submitted" as const, approvedAt: null, dueDate: past },
    { status: "assigned" as const, approvedAt: null, dueDate: null },
    { status: "in_progress" as const, approvedAt: null, dueDate: null },
    { status: "ready_for_review" as const, approvedAt: null, dueDate: null },
    {
      status: "ready_for_review" as const,
      approvedAt: approved,
      dueDate: past,
    },
    {
      status: "revision_requested" as const,
      approvedAt: approved,
      dueDate: past,
    },
    { status: "delivered" as const, approvedAt: approved, dueDate: past },
  ];

  const rowsFor = (view: Parameters<typeof matchesView>[1]) =>
    TICKETS.filter((t) => matchesView(t, view, NOW_D)).length;

  it.each([
    ["Open tickets", "open", 6],
    /* 3, not 4: the draft past its due date is excluded by status, and so is
       the delivered one. The two approved-then-reopened rows DO count — that
       was the round-two bug. */
    ["Overdue", "overdue", 3],
    /* 2, not 1: the second is approved-then-reopened. approvedAt records the
       FIRST sign-off and is never cleared, so it says nothing about the round
       now in front of the client. */
    ["Ready for review", "awaiting_review", 2],
    ["Delivered", "approved", 1],
  ] as const)("%s", async (_label, view, expected) => {
    // The fixture count is stated as a literal, so widening the predicate
    // fails here even though the SQL tests would follow it.
    expect(rowsFor(view)).toBe(expected);
  });

  /* And the card actually points at that view. */
  it.each([
    [`Open tickets${COUNTS.open}`, "open"],
    [`Overdue${COUNTS.overdue}`, "overdue"],
    [`Ready for review${COUNTS.awaitingReview}`, "awaiting_review"],
    [`Delivered${COUNTS.delivered}`, "approved"],
  ])("%s opens the view it counts", async (text, view) => {
    await renderDashboard();
    expect(scopeOf(card(text)).view).toBe(view);
  });
});

describe("the status overview is zero-filled", () => {
  /* BUG-002 names seven statuses that must have navigation.
     getTicketCountsByStatus is a GROUP BY, so without the fill a status with no
     tickets renders no row at all — "navigation for Draft" existed only while a
     draft did. The mock returns rows for three statuses; all seven must show. */
  it("renders every status in the enum, present or not", async () => {
    await renderDashboard();
    for (const status of TICKET_STATUSES) {
      expect(scopeOf(statusCard(status)).status).toEqual([status]);
    }
  });

  it("shows a real zero rather than omitting the row", async () => {
    await renderDashboard();
    // `assigned` has no row in the mocked rollup.
    expect(statusCard("assigned").textContent).toMatch(/0$/);
  });

  /* Whatever the planner returns, the operator sees the same order twice. */
  it("orders the rows the same way every render", async () => {
    await renderDashboard();
    const first = screen
      .getAllByRole("link")
      .map((l) => l.getAttribute("href"))
      .filter((h) => h?.includes("status="));
    cleanup();
    await renderDashboard();
    const second = screen
      .getAllByRole("link")
      .map((l) => l.getAttribute("href"))
      .filter((h) => h?.includes("status="));
    expect(second).toEqual(first);
  });
});
