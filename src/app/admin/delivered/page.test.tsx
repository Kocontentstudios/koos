import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const TOLU = "11111111-1111-1111-1111-111111111111";

vi.mock("@/lib/auth/require-role", () => ({
  requireRole: async () => ({ dbUser: { id: "a1", role: "admin" } }),
}));

vi.mock("nuqs", () => ({
  useQueryStates: () => [{ q: "", page: 1 }, vi.fn()],
}));

const listDeliveredProjects = vi.fn();
const countAdminTickets = vi.fn();

vi.mock("@/lib/db/queries", () => ({
  listDeliveredProjects: (...a: unknown[]) => listDeliveredProjects(...a),
  countAdminTickets: (...a: unknown[]) => countAdminTickets(...a),
}));

import AdminDeliveredPage from "./page";

beforeEach(() => {
  listDeliveredProjects.mockClear();
  countAdminTickets.mockClear();
});

const DELIVERED = new Date("2026-08-24T12:00:00Z");
const APPROVED = new Date("2026-09-01T12:00:00Z");

function project(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    ticketNumber: 73,
    title: "Signed off",
    designType: "Brochure",
    status: "delivered",
    deliveredAt: DELIVERED,
    approvedAt: APPROVED,
    brandName: "Acme Co",
    requesterFirstName: "Cara",
    requesterLastName: "Client",
    requesterEmail: "cara@koos.test",
    designerId: TOLU,
    designerFirstName: "Bimpe",
    designerLastName: "Okafor",
    designerEmail: "bimpe@koos.test",
    firstDeliverableAt: null,
    ...over,
  };
}

async function renderPage(
  params: Record<string, string> = {},
  rows = [project()],
  total = rows.length,
) {
  listDeliveredProjects.mockResolvedValue(rows);
  countAdminTickets.mockResolvedValue(total);
  render(await AdminDeliveredPage({ searchParams: Promise.resolve(params) }));
}

const rowText = () =>
  Array.from(document.querySelectorAll("tbody tr td"))
    .map((c) => c.textContent)
    .join(" | ");

/* The ticket names nine things each row must show. */
describe("every column the ticket asks for", () => {
  it.each([
    ["ticket ID", /DT-00073/],
    ["project title", /Signed off/],
    ["brand", /Acme Co/],
    ["requester", /Cara Client/],
    ["assigned designer", /Bimpe Okafor/],
    ["delivered date", /Aug 24, 2026/],
    ["approved date", /Sep 1, 2026/],
  ])("shows the %s", async (_label, expected) => {
    await renderPage();
    expect(rowText()).toMatch(expected);
  });

  it("shows the final status", async () => {
    await renderPage();
    // The badge and its cell both match the exact string, so scope to the cell.
    const statusCell = document.querySelector("tbody tr td:nth-child(8)");
    expect(statusCell?.textContent).toBe("Approved");
  });

  /* Named, not nine identical "View" links — a screen reader hears which. */
  it("links to the ticket by number", async () => {
    await renderPage();
    const link = screen
      .getAllByRole("link")
      .find((l) => (l.textContent ?? "").startsWith("View"));
    expect(link?.textContent).toBe("View DT-00073");
    expect(link?.getAttribute("href")).toBe("/admin/tickets/t1");
  });
});

describe("dates", () => {
  /* approvedAt is null until the client answers; the column must say so
     rather than rendering an empty cell that reads as a missing value. */
  it("says so when nothing has been approved yet", async () => {
    await renderPage({}, [
      project({ status: "ready_for_review", approvedAt: null }),
    ]);
    expect(rowText()).toContain("—");
  });

  /* deliveredDateOf's fallback: a row written between the backfill and the
     deploy that started populating the column. */
  /* The fixture is the WIRE STRING, which is what postgres-js returns for a
     raw sql field. A `new Date(...)` fixture here passed against code that
     threw on the real value and took the whole route down with it. */
  it("falls back to the first deliverable when the column is empty", async () => {
    await renderPage({}, [
      project({
        deliveredAt: null,
        firstDeliverableAt: "2026-07-04 12:00:00",
      }),
    ]);
    expect(rowText()).toMatch(/Jul 4, 2026/);
  });

  it("renders a blank cell rather than crashing on an undecodable value", async () => {
    await renderPage({}, [
      project({ deliveredAt: null, firstDeliverableAt: "not a date" }),
    ]);
    expect(rowText()).toContain("—");
  });

  it("shows a dash when neither is known", async () => {
    await renderPage({}, [
      project({ deliveredAt: null, firstDeliverableAt: null }),
    ]);
    expect(rowText()).toContain("—");
  });
});

describe("the filters", () => {
  /* Colour alone cannot say which chip is active. */
  it("marks the active chip for assistive tech", async () => {
    await renderPage({ view: "approved" });
    expect(
      screen.getByRole("link", { name: "Approved / completed" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", { name: "All delivered" }),
    ).not.toHaveAttribute("aria-current");
  });

  it.each([
    ["All delivered", "delivered"],
    ["Awaiting review", "awaiting_review"],
    ["Approved / completed", "approved"],
  ])("%s opens the %s view", async (label, view) => {
    await renderPage();
    const href =
      screen.getByRole("link", { name: label }).getAttribute("href") ?? "";
    expect(href).toContain("/admin/delivered");
    expect(href).toContain(`view=${view}`);
  });

  /* A status narrows WITHIN a view, so carrying it across a chip click can
     produce an unsatisfiable AND — the same trap the queue's tabs hit. */
  it("clears the status filter when switching chip", async () => {
    await renderPage({ view: "delivered", status: "delivered" });
    for (const label of ["Awaiting review", "All delivered"]) {
      expect(
        screen.getByRole("link", { name: label }).getAttribute("href"),
      ).not.toContain("status=");
    }
  });
});

describe("the page is only ever about delivered work", () => {
  /* The dashboard's status rows arrive with view=all. Rendering an unrelated
     list under a "Delivered Projects" heading would be the same lie as a
     mislabelled empty state. */
  it.each(["all", "open", "overdue", "in_progress"])(
    "reads an arriving %s view as its own default",
    async (view) => {
      await renderPage({ view });
      const scope = listDeliveredProjects.mock.calls[0]?.[0] as {
        view: string;
      };
      expect(scope.view).toBe("delivered");
    },
  );

  it("honours a view the page actually offers", async () => {
    await renderPage({ view: "approved" });
    const scope = listDeliveredProjects.mock.calls[0]?.[0] as
      | { view: string }
      | undefined;
    expect(scope?.view).toBe("approved");
  });

  /* The status row arrives as ?view=all&status=ready_for_review and must show
     exactly the number the dashboard displayed. */
  it("keeps the status narrowing the dashboard row carried", async () => {
    await renderPage({ view: "all", status: "ready_for_review" });
    const scope = listDeliveredProjects.mock.calls[0]?.[0] as {
      view: string;
      status: string[];
    };
    expect(scope.view).toBe("delivered");
    expect(scope.status).toEqual(["ready_for_review"]);
  });

  /* The list and the count must be asked the same question — tested with a
     view the page COERCES, so the count receiving the raw scope is visible.
     With `approved` (already a page view) the coercion is a no-op and handing
     the count `raw` passed: it would have printed a total for every ticket in
     the system above a delivered-only table. */
  it.each([
    ["a coerced view", { view: "all", status: "delivered" }],
    ["a page view", { view: "approved", q: "acme" }],
    ["a search", { q: "acme" }],
    ["a date window", { range: "7d" }],
  ])("counts the same scope it lists under %s", async (_label, params) => {
    await renderPage(params);
    expect(listDeliveredProjects.mock.calls[0]?.[0]).toEqual(
      countAdminTickets.mock.calls[0]?.[0],
    );
  });

  it("counts a coerced view, never the raw one", async () => {
    await renderPage({ view: "all", status: "delivered" });
    const counted = countAdminTickets.mock.calls[0]?.[0] as { view: string };
    expect(counted.view).toBe("delivered");
    expect(counted.view).not.toBe("all");
  });
});

describe("empty states name what is empty", () => {
  it.each([
    ["delivered", /nothing has been delivered yet/i],
    ["awaiting_review", /nothing is waiting on a client/i],
    ["approved", /no work has been signed off/i],
  ])("%s", async (view, expected) => {
    await renderPage({ view }, [], 0);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("blames the search rather than the studio's output", async () => {
    await renderPage({ q: "zzzz" }, [], 0);
    expect(screen.getByText(/nothing matches "zzzz"/i)).toBeInTheDocument();
  });

  it("blames a filter rather than the studio's output", async () => {
    await renderPage({ assignee: TOLU }, [], 0);
    expect(
      screen.getByText(/nothing matches these filters/i),
    ).toBeInTheDocument();
  });

  it("says when the page is past the end", async () => {
    await renderPage({ page: "99" }, [], 137);
    expect(screen.getByText(/past the end/i)).toBeInTheDocument();
  });

  /* A studio that has delivered nothing is not "past the end of the list" —
     it has no list. `total > 0` is what tells those two apart. */
  it("does not call an empty studio a paging mistake", async () => {
    await renderPage({ page: "5" }, [], 0);
    expect(
      screen.getByText(/nothing has been delivered yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/past the end/i)).not.toBeInTheDocument();
  });
});

describe("the header says what is on screen", () => {
  it("names the view", async () => {
    await renderPage({ view: "approved" });
    expect(screen.getByText(/Approved work/)).toBeInTheDocument();
  });

  it("names an active status narrowing", async () => {
    await renderPage({ view: "all", status: "ready_for_review" });
    expect(
      screen.getByText(/status: Delivered — Your Review/),
    ).toBeInTheDocument();
  });
});

describe("paging", () => {
  it("offers a way forward", async () => {
    await renderPage({}, [project()], 137);
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /next/i }).getAttribute("href"),
    ).toContain("page=2");
  });

  it("steps back to the last real page from past the end", async () => {
    await renderPage({ page: "99" }, [], 137);
    expect(
      screen.getByRole("link", { name: /previous/i }).getAttribute("href"),
    ).toContain("page=3");
  });

  /* total:4 gives pages:1, so `pages > 1` is false and the `|| page > pages`
     branch is the only reason a pager renders. With a multi-page total that
     branch is never the reason and deleting it stays green. */
  it("still offers a way back from past the end of a single-page list", async () => {
    await renderPage({ page: "99" }, [], 4);
    expect(
      screen.getByRole("navigation", { name: /pagination/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /previous/i })).toBeInTheDocument();
  });
});

describe("a row always has a name", () => {
  /* `title` is nullable — a ticket filed from a calendar item has none — so
     the Project column would render blank without the fallback. */
  it("falls back to the design type when the ticket has no title", async () => {
    await renderPage({}, [
      project({ title: null, designType: "Instagram Carousel" }),
    ]);
    expect(rowText()).toContain("Instagram Carousel");
  });
});

describe("an empty list names the most specific reason", () => {
  /* A search inside a filtered view is empty because of the SEARCH — that is
     the term the operator just typed and the one they can correct. */
  it("blames the search ahead of the filters", async () => {
    await renderPage({ q: "zzzz", assignee: TOLU, range: "7d" }, [], 0);
    expect(screen.getByText(/nothing matches "zzzz"/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/nothing matches these filters/i),
    ).not.toBeInTheDocument();
  });
});

describe("the date filter the ticket asks for", () => {
  it("offers a delivery-date window", async () => {
    await renderPage();
    for (const label of [
      "Any time",
      "Last 7 days",
      "Last 30 days",
      "Last 90 days",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  /* Anchored on delivery, not creation. A Delivered Projects filter that
     silently measured creation date would answer a different question. */
  it("anchors the window on the delivery date", async () => {
    await renderPage();
    const href =
      screen.getByRole("link", { name: "Last 30 days" }).getAttribute("href") ??
      "";
    expect(href).toContain("range=30d");
    expect(href).toContain("on=delivered");
  });

  it("pins the anchor even against a hand-edited URL", async () => {
    await renderPage({ range: "7d", on: "created" });
    const scope = listDeliveredProjects.mock.calls[0]?.[0] as { on: string };
    expect(scope.on).toBe("delivered");
  });

  /* Changing the window changes the result set, so the old offset is
     meaningless — without the reset, switching to "Last 7 days" from page 4
     lands past the end of a shorter list. */
  it("returns to the first page when the window changes", async () => {
    await renderPage({ page: "4" });
    const href =
      screen.getByRole("link", { name: "Last 7 days" }).getAttribute("href") ??
      "";
    expect(href).not.toContain("page=4");
  });

  it("marks the active window", async () => {
    await renderPage({ range: "7d" });
    expect(screen.getByRole("link", { name: "Last 7 days" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  /* An empty date-filtered list is a statement about the window. */
  it("blames the window rather than the studio's output", async () => {
    await renderPage({ range: "7d" }, [], 0);
    expect(
      screen.getByText(/nothing matches these filters/i),
    ).toBeInTheDocument();
  });
});

describe("people are named, never blank", () => {
  /* first_name and last_name are NOT NULL but permit the EMPTY STRING, so a
     real user can have no display name — the seeded nameless designer proves
     it. Without the email fallback the cell renders blank and the row looks
     like it belongs to nobody. */
  it("falls back to the email for a designer with no name", async () => {
    await renderPage({}, [
      project({
        designerFirstName: "",
        designerLastName: "",
        designerEmail: "nameless@koos.test",
      }),
    ]);
    expect(rowText()).toContain("nameless@koos.test");
  });

  it("falls back to the email for a requester with no name", async () => {
    await renderPage({}, [
      project({
        requesterFirstName: "",
        requesterLastName: "",
        requesterEmail: "silent@koos.test",
      }),
    ]);
    expect(rowText()).toContain("silent@koos.test");
  });

  /* Genuinely unassigned is a different statement from "we cannot name them". */
  it("says Unassigned when nobody is carrying it", async () => {
    await renderPage({}, [
      project({
        designerId: null,
        designerFirstName: "",
        designerLastName: "",
        designerEmail: null,
      }),
    ]);
    expect(rowText()).toContain("Unassigned");
  });
});

describe("the header count is the whole result set", () => {
  /* It comes from countAdminTickets, not from the rows on screen — that is the
     difference between "137 projects" and "50 projects" on page one. */
  it("reports the total, not the page", async () => {
    await renderPage({}, [project()], 137);
    expect(screen.getByText(/137 projects/)).toBeInTheDocument();
  });

  it("says project, singular, for one", async () => {
    await renderPage({}, [project()], 1);
    expect(screen.getByText(/^1 project$/)).toBeInTheDocument();
  });
});

describe("the page owns its own ordering", () => {
  /* DEFAULT_SORT_KEY is shared with the queue, which shows the same
     `awaiting_review` view and means something different by it. Setting a
     delivery-date default there re-sorted a page this unit does not own. */
  it.each([
    ["delivered", "delivered"],
    ["awaiting_review", "delivered"],
    ["approved", "approved"],
  ])("%s orders by %s", async (view, sort) => {
    await renderPage({ view });
    const scope = listDeliveredProjects.mock.calls[0]?.[0] as { sort: string };
    expect(scope.sort).toBe(sort);
  });

  /* A default, not an override: a shared link carrying an explicit sort must
     still win. */
  it("yields to an explicit sort in the URL", async () => {
    await renderPage({ view: "delivered", sort: "ticket:desc" });
    const scope = listDeliveredProjects.mock.calls[0]?.[0] as { sort: string };
    expect(scope.sort).toBe("ticket:desc");
  });

  it("hands the count the same sort-bearing scope it lists", async () => {
    await renderPage({ view: "awaiting_review" });
    expect(listDeliveredProjects.mock.calls[0]?.[0]).toEqual(
      countAdminTickets.mock.calls[0]?.[0],
    );
  });
});
