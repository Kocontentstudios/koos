import { describe, expect, it } from "vitest";
import {
  ADMIN_TICKET_VIEWS,
  type AdminTicketView,
  clampPage,
  formatOverdue,
  isSortable,
  matchesView,
  overdueMs,
  resolveWindow,
  sortToColumn,
  statusRowHref,
  VIEW_PREDICATES,
} from "./scope";

const NOW = new Date("2026-09-03T12:00:00Z");

type Row = Parameters<typeof matchesView>[0];

function ticket(over: Partial<Row> = {}): Row {
  return {
    status: "submitted",
    approvedAt: null,
    dueDate: null,
    ...over,
  };
}

describe("the view vocabulary is exhaustive", () => {
  /* The translator switches on this map. A view added to the union without a
     predicate compiles fine and then matches nothing at runtime. */
  it("has a predicate for every view and no orphans", () => {
    expect(Object.keys(VIEW_PREDICATES).sort()).toEqual(
      [...ADMIN_TICKET_VIEWS].sort(),
    );
  });
});

describe("ticket language maps onto the enum", () => {
  /* The dashboard counts "open" with its own inline Set. If these two ever
     disagree, the card's number stops matching the list it opens. */
  it("open is every status except draft and delivered", () => {
    const open = [
      "submitted",
      "assigned",
      "in_progress",
      "ready_for_review",
      "revision_requested",
    ] as const;
    for (const status of open) {
      expect(matchesView(ticket({ status }), "open", NOW)).toBe(true);
    }
    expect(matchesView(ticket({ status: "draft" }), "open", NOW)).toBe(false);
    expect(matchesView(ticket({ status: "delivered" }), "open", NOW)).toBe(
      false,
    );
  });

  /* Must stay byte-identical to getDesignerLoads, or clicking a designer's
     workload opens a list with a different count than the row showed. */
  it("active is the designer-workload set", () => {
    for (const status of [
      "assigned",
      "in_progress",
      "ready_for_review",
    ] as const) {
      expect(matchesView(ticket({ status }), "active", NOW)).toBe(true);
    }
    expect(matchesView(ticket({ status: "submitted" }), "active", NOW)).toBe(
      false,
    );
  });

  /* There is no `approved` status — approval is a nullable timestamp, and
     `delivered` is what the UI already labels "Approved". */
  it("approved and completed are the same predicate", () => {
    expect(VIEW_PREDICATES.completed).toEqual(VIEW_PREDICATES.approved);
    expect(matchesView(ticket({ status: "delivered" }), "approved", NOW)).toBe(
      true,
    );
  });

  it("delivered covers work with the client, approved or not", () => {
    for (const status of ["ready_for_review", "delivered"] as const) {
      expect(matchesView(ticket({ status }), "delivered", NOW)).toBe(true);
    }
    expect(
      matchesView(ticket({ status: "in_progress" }), "delivered", NOW),
    ).toBe(false);
  });

  /* recordDeliverableVersion sets ready_for_review on EVERY upload and never
     clears approvedAt, so a correction round after sign-off lands here. */
  it("awaiting_review excludes work the client already approved", () => {
    expect(
      matchesView(
        ticket({ status: "ready_for_review" }),
        "awaiting_review",
        NOW,
      ),
    ).toBe(true);
    expect(
      matchesView(
        ticket({
          status: "ready_for_review",
          approvedAt: new Date("2026-08-01"),
        }),
        "awaiting_review",
        NOW,
      ),
    ).toBe(false);
  });

  it("reopened is the approved-then-moved-on set", () => {
    expect(
      matchesView(
        ticket({ status: "in_progress", approvedAt: new Date("2026-08-01") }),
        "reopened",
        NOW,
      ),
    ).toBe(true);
    expect(
      matchesView(
        ticket({ status: "delivered", approvedAt: new Date("2026-08-01") }),
        "reopened",
        NOW,
      ),
    ).toBe(false);
  });
});

describe("overdue", () => {
  const past = new Date("2026-09-01T12:00:00Z");
  const future = new Date("2026-09-10T12:00:00Z");

  it("is a past due date on live work", () => {
    expect(
      matchesView(
        ticket({ status: "in_progress", dueDate: past }),
        "overdue",
        NOW,
      ),
    ).toBe(true);
  });

  /* The shipped count says `status != 'delivered'`, which counts a ticket
     nobody ever submitted. */
  it("does not count an unsubmitted draft", () => {
    expect(
      matchesView(ticket({ status: "draft", dueDate: past }), "overdue", NOW),
    ).toBe(false);
  });

  /* Nor one the client already signed off, which the same query counts the
     moment a correction upload moves it off `delivered`. */
  it("does not count work already approved", () => {
    expect(
      matchesView(
        ticket({
          status: "in_progress",
          dueDate: past,
          approvedAt: new Date("2026-08-01"),
        }),
        "overdue",
        NOW,
      ),
    ).toBe(false);
  });

  it("does not count a future or absent due date", () => {
    expect(
      matchesView(
        ticket({ status: "in_progress", dueDate: future }),
        "overdue",
        NOW,
      ),
    ).toBe(false);
    expect(matchesView(ticket({ status: "in_progress" }), "overdue", NOW)).toBe(
      false,
    );
  });

  it("measures how long overdue against the given clock", () => {
    expect(overdueMs(past, NOW)).toBe(2 * 24 * 60 * 60 * 1000);
    expect(overdueMs(future, NOW)).toBeNull();
    expect(overdueMs(null, NOW)).toBeNull();
  });

  it("reads the lateness the way an operator says it", () => {
    const day = 24 * 60 * 60 * 1000;
    expect(formatOverdue(2 * day)).toBe("2 days");
    expect(formatOverdue(day)).toBe("1 day");
    expect(formatOverdue(5 * 60 * 60 * 1000)).toBe("5 hours");
    expect(formatOverdue(90 * 60 * 1000)).toBe("1 hour");
    expect(formatOverdue(30 * 1000)).toBe("just now");
  });
});

describe("status rows link somewhere that can serve them", () => {
  it("sends approved and awaiting-review work to Delivered Projects", () => {
    expect(statusRowHref("delivered")).toContain("/admin/delivered");
    expect(statusRowHref("ready_for_review")).toContain("/admin/delivered");
  });

  it("sends every other status to the ticket list", () => {
    for (const s of [
      "draft",
      "submitted",
      "assigned",
      "in_progress",
      "revision_requested",
    ] as const) {
      expect(statusRowHref(s)).toContain("/admin/tickets");
      expect(statusRowHref(s)).toContain(s);
    }
  });
});

describe("the date window", () => {
  /* Parsed from the strings, never `new Date()`: the server renders in its own
     zone, so building the boundary from a Date makes the range land a day out
     for anyone not on UTC. */
  it("takes a custom range as whole UTC days", () => {
    const w = resolveWindow({
      range: "custom",
      from: "2026-07-19",
      to: "2026-07-25",
      now: NOW,
    });
    expect(w.from?.toISOString()).toBe("2026-07-19T00:00:00.000Z");
    expect(w.to.toISOString()).toBe("2026-07-26T00:00:00.000Z");
  });

  it("swaps a reversed custom range rather than returning nothing", () => {
    const w = resolveWindow({
      range: "custom",
      from: "2026-07-25",
      to: "2026-07-19",
      now: NOW,
    });
    expect(w.from?.toISOString()).toBe("2026-07-19T00:00:00.000Z");
  });

  it("falls back to the preset when a custom range is incomplete", () => {
    const w = resolveWindow({ range: "custom", from: "", to: "", now: NOW });
    expect(w.from?.toISOString()).toBe(
      new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    );
  });

  it.each([
    ["7d", 7],
    ["15d", 15],
    ["30d", 30],
    ["90d", 90],
  ] as const)("resolves %s to that many days back", (range, days) => {
    const w = resolveWindow({ range, now: NOW });
    if (!w.from) throw new Error(`${range} should be a bounded window`);
    expect(w.to.getTime() - w.from.getTime()).toBe(days * 24 * 60 * 60 * 1000);
  });

  it("returns an unbounded window for all", () => {
    expect(resolveWindow({ range: "all", now: NOW }).from).toBeNull();
  });
});

describe("sorting and paging never reach SQL unchecked", () => {
  it("maps a whitelisted sort", () => {
    expect(sortToColumn("created:desc")).toEqual({
      field: "createdAt",
      direction: "desc",
    });
  });

  /* "how long overdue" is the due date read backwards, and a ticket with no
     due date is not the most overdue thing in the list. */
  it("sorts most-overdue first by due date, nulls last", () => {
    expect(sortToColumn("overdue:desc")).toEqual({
      field: "dueDate",
      direction: "asc",
      nulls: "last",
    });
  });

  it("falls back rather than trusting a hand-edited URL", () => {
    for (const junk of [
      "",
      "nope:desc",
      "createdAt; DROP TABLE",
      "created:sideways",
    ]) {
      expect(sortToColumn(junk).field).toBe("createdAt");
    }
  });

  it("clamps the page to something a query can use", () => {
    expect(clampPage(1)).toBe(1);
    expect(clampPage(0)).toBe(1);
    expect(clampPage(-5)).toBe(1);
    expect(clampPage(Number.NaN)).toBe(1);
    expect(clampPage(10_000)).toBeLessThanOrEqual(1000);
  });
});

describe("every view is reachable and coherent", () => {
  it.each([...ADMIN_TICKET_VIEWS])(
    "%s matches at least one ticket shape",
    (view) => {
      const shapes: Row[] = [
        ticket({ status: "draft" }),
        ticket({ status: "submitted", dueDate: new Date("2026-09-01") }),
        ticket({ status: "assigned" }),
        ticket({ status: "in_progress", approvedAt: new Date("2026-08-01") }),
        ticket({ status: "ready_for_review" }),
        ticket({ status: "delivered", approvedAt: new Date("2026-08-01") }),
        ticket({ status: "revision_requested" }),
      ];
      expect(
        shapes.some((r) => matchesView(r, view as AdminTicketView, NOW)),
      ).toBe(true);
    },
  );
});

describe("isSortable gates what reaches the query layer", () => {
  it.each([
    "created",
    "created:asc",
    "created:desc",
    "overdue:desc",
    "priority:asc",
  ])("accepts %s", (v) => expect(isSortable(v)).toBe(true));

  it.each([
    "",
    "nope",
    "nope:desc",
    "createdAt; DROP TABLE",
    "created:sideways",
  ])("rejects %s", (v) => expect(isSortable(v)).toBe(false));
});
