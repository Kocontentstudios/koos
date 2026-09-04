import { beforeEach, describe, expect, it, vi } from "vitest";

/* The three dashboard count adapters are one line each and were never
   executed: every test that renders the dashboard mocks them. Pointing
   getOverdueTicketCount at `view: "open"` — so the Overdue card reports the
   whole queue — passed the full suite. */
const countAdminTickets = vi.fn();

vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("./admin-tickets", async () => {
  const actual =
    await vi.importActual<typeof import("./admin-tickets")>("./admin-tickets");
  return {
    ...actual,
    countAdminTickets: (...a: unknown[]) => countAdminTickets(...a),
  };
});

import { VIEW_PREDICATES } from "@/lib/admin/scope";
import {
  getAwaitingReviewCount,
  getOpenTicketCount,
  getOverdueTicketCount,
} from "./index";

beforeEach(() => {
  countAdminTickets.mockReset();
  countAdminTickets.mockResolvedValue(0);
});

const viewOf = () =>
  (countAdminTickets.mock.calls[0]?.[0] as { view: string } | undefined)?.view;

describe("each dashboard card counts the view its link opens", () => {
  it.each([
    ["Overdue", getOverdueTicketCount, "overdue"],
    ["Ready for review", getAwaitingReviewCount, "awaiting_review"],
    ["Open tickets", getOpenTicketCount, "open"],
  ])("%s", async (_label, fn, view) => {
    await fn();
    expect(viewOf()).toBe(view);
  });

  /* Each must resolve a DIFFERENT predicate — pointing two cards at one view
     is the drift these tickets exist to remove. */
  it("no two cards resolve the same predicate", async () => {
    const views: string[] = [];
    for (const fn of [
      getOverdueTicketCount,
      getAwaitingReviewCount,
      getOpenTicketCount,
    ]) {
      countAdminTickets.mockClear();
      await fn();
      views.push(viewOf() ?? "");
    }
    expect(new Set(views).size).toBe(3);
    for (const view of views) expect(VIEW_PREDICATES).toHaveProperty(view);
  });

  /* A count is over the whole set: a leftover page offset would silently
     under-report every card. */
  it("counts from the first page with no other narrowing", async () => {
    await getOverdueTicketCount();
    const scope = countAdminTickets.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(scope.page).toBe(1);
    expect(scope.status).toEqual([]);
    expect(scope.assignee).toBe("");
    expect(scope.q).toBe("");
  });
});
