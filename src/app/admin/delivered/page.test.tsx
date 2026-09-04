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
    createdAt: new Date("2026-08-10T12:00:00Z"),
    brandId: "b1",
    brandName: "Acme Co",
    requesterId: "u1",
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
  it("falls back to the first deliverable when the column is empty", async () => {
    await renderPage({}, [
      project({
        deliveredAt: null,
        firstDeliverableAt: new Date("2026-07-04T12:00:00Z"),
      }),
    ]);
    expect(rowText()).toMatch(/Jul 4, 2026/);
  });

  it("shows a dash when neither is known", async () => {
    await renderPage({}, [
      project({ deliveredAt: null, firstDeliverableAt: null }),
    ]);
    expect(rowText()).toContain("—");
  });
});

describe("the filters", () => {
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

  /* The list and the count must be asked the same question. */
  it("counts the same scope it lists", async () => {
    await renderPage({ view: "approved", q: "acme" });
    expect(listDeliveredProjects.mock.calls[0]?.[0]).toEqual(
      countAdminTickets.mock.calls[0]?.[0],
    );
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
});
