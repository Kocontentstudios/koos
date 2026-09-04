import { render, screen } from "@testing-library/react";
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

vi.mock("@/lib/db/queries", () => ({
  getTicketCountsByStatus: async () => [
    { status: "submitted", count: 11 },
    // Larger than awaitingReview on purpose: a ticket approved and then
    // re-uploaded is ready_for_review again and keeps its approvedAt, so the
    // raw status count is the WRONG number for the card.
    { status: "ready_for_review", count: 9 },
    { status: "delivered", count: COUNTS.delivered },
  ],
  getOpenTicketCount: async () => COUNTS.open,
  getOverdueTicketCount: async () => COUNTS.overdue,
  getAwaitingReviewCount: async () => COUNTS.awaitingReview,
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

import { loadAdminScope } from "@/lib/admin/scope-params";
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
    // Most overdue first: the point of the drill-down is triage.
    expect(scope.sort).toContain("overdue");
  });

  /* The exact drift this ticket exists to fix: the card counted the raw
     `ready_for_review` status (9) while the link opened `awaiting_review` (7),
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
    expect(scopeOf(card("Delivered — Your Review9")).status).toEqual([
      "ready_for_review",
    ]);
    expect(scopeOf(card("Approved23")).status).toEqual(["delivered"]);
    /* A status row must not inherit the queue's default view, which excludes
       drafts and delivered work — that made these two open an empty list. */
    expect(scopeOf(card("Approved23")).view).toBe("all");
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
