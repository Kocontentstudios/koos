import { describe, expect, it } from "vitest";
import { TICKET_STATUSES } from "@/lib/design/tickets-ui";
import {
  ADMIN_TICKET_VIEWS,
  type AdminTicketView,
  clampPage,
  defaultSortKeyFor,
  formatOverdue,
  isSortable,
  lateChipFor,
  matchesView,
  overdueMs,
  pageCount,
  resolveWindow,
  rowActionsFor,
  sortToColumn,
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
  /* The dashboard's Open card resolves this same predicate through
     getOpenTicketCount, so the card's number and the list it opens cannot
     disagree. This pins what the predicate means. */
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
  /* recordDeliverableVersion sets ready_for_review on EVERY upload and never
     clears approvedAt, so a correction round after sign-off lands here. */
  /* The inverse of what this used to assert. recordDeliverableVersion sets
     ready_for_review on EVERY upload and notifies the client, so a correction
     round genuinely IS awaiting review — and approvedAt still holds the FIRST
     sign-off, which says nothing about the round now in front of them.
     Excluding it hid exactly the work clients were sitting on, and made the
     card disagree with the status row for one status. */
  it("awaiting_review includes a correction round after an earlier sign-off", () => {
    for (const approvedAt of [null, new Date("2026-08-01")]) {
      expect(
        matchesView(
          ticket({ status: "ready_for_review", approvedAt }),
          "awaiting_review",
          NOW,
        ),
      ).toBe(true);
    }
  });

  /* And it is exactly the raw status, so the card and the status row for that
     status are two routes to one number. */
  it("awaiting_review is exactly the ready_for_review status", () => {
    for (const status of TICKET_STATUSES) {
      expect(
        matchesView(
          { status, approvedAt: null, dueDate: null },
          "awaiting_review",
          NOW,
        ),
      ).toBe(status === "ready_for_review");
    }
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

  /* Signed-off work is excluded by its STATUS, not by approvedAt. */
  it("does not count work sitting at delivered", () => {
    expect(
      matchesView(
        ticket({
          status: "delivered",
          dueDate: past,
          approvedAt: new Date("2026-08-01"),
        }),
        "overdue",
        NOW,
      ),
    ).toBe(false);
  });

  /* The regression this replaces an inverted assertion for. approvedAt is
     NEVER cleared (schema.ts), so gating on it meant a ticket that was once
     approved could not be overdue again — ever. A client asks for a change
     after sign-off, the studio sets a new due date, the date passes, and the
     ticket is invisible in the one view whose job is to surface exactly
     that. */
  it("counts a ticket reopened after sign-off and now past its new date", () => {
    for (const status of ["revision_requested", "in_progress"] as const) {
      expect(
        matchesView(
          ticket({
            status,
            dueDate: past,
            approvedAt: new Date("2026-08-01"),
          }),
          "overdue",
          NOW,
        ),
      ).toBe(true);
    }
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
    expect(formatOverdue(30 * 1000)).toBe("less than an hour");
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
    expect(w.to?.toISOString()).toBe("2026-07-26T00:00:00.000Z");
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

  /* "Since the 19th" is an answerable question. Substituting 30 days answers a
     different one without telling anybody. */
  it("honours a custom range with only a start", () => {
    const w = resolveWindow({
      range: "custom",
      from: "2026-07-19",
      to: "",
      now: NOW,
    });
    expect(w.from?.toISOString()).toBe("2026-07-19T00:00:00.000Z");
    expect(w.to).toEqual(NOW);
  });

  it("honours a custom range with only an end", () => {
    const w = resolveWindow({
      range: "custom",
      from: "",
      to: "2026-07-25",
      now: NOW,
    });
    expect(w.from).toBeNull();
    expect(w.to?.toISOString()).toBe("2026-07-26T00:00:00.000Z");
  });

  it("falls back to the preset only when neither bound is given", () => {
    const w = resolveWindow({ range: "custom", from: "", to: "", now: NOW });
    expect(w.from?.toISOString()).toBe(
      new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    );
  });

  /* A malformed bound is not a bound. It must not be read as one. */
  it("ignores a bound that is not a calendar day", () => {
    const w = resolveWindow({
      range: "custom",
      from: "19-07-2026",
      to: "",
      now: NOW,
    });
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
    if (!w.from || !w.to) throw new Error(`${range} should be bounded`);
    expect(w.to.getTime() - w.from.getTime()).toBe(days * 24 * 60 * 60 * 1000);
  });

  /* Unbounded at BOTH ends. A `to` of `now` here reads as a real upper bound
     to the consumer, which then hides every future due date. */
  it("returns a window unbounded at both ends for all", () => {
    const w = resolveWindow({ range: "all", now: NOW });
    expect(w.from).toBeNull();
    expect(w.to).toBeNull();
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
  it("sorts most-overdue first by due date, ignoring a contrary suffix", () => {
    expect(sortToColumn("overdue:desc")).toEqual({
      field: "dueDate",
      direction: "asc",
      fixedDirection: true,
    });
  });

  /* Plain fields DO honour the suffix — the lock is specific to sorts whose
     name already states a direction. */
  it("honours the suffix on a plain field", () => {
    expect(sortToColumn("created:asc").direction).toBe("asc");
    expect(sortToColumn("ticket:asc").direction).toBe("asc");
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

/* Every caller concatenates " overdue". A value that does not read as a
   duration there ships to a designer as an email SUBJECT LINE. */
describe("lateness reads as a duration in the sentence that carries it", () => {
  it.each([
    30 * 1000,
    59 * 60 * 1000,
    3 * 60 * 60 * 1000,
    5 * 24 * 60 * 60 * 1000,
  ])("reads correctly at %ims", (ms) => {
    const sentence = `DT-0012 is ${formatOverdue(ms)} overdue`;
    expect(sentence).not.toMatch(/is just now overdue/);
    expect(sentence).toMatch(
      /^DT-0012 is (less than an hour|\d+ (hour|hours|day|days)) overdue$/,
    );
  });
});

describe("paging", () => {
  /* An empty list is page 1 of 1. "Page 1 of 0" is a pager describing a page
     that cannot exist. */
  it("never reports fewer than one page", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(0, 10)).toBe(1);
  });

  it("counts partial pages", () => {
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
    expect(pageCount(137, 50)).toBe(3);
  });
});

describe("a view sorts by what its reader is looking for", () => {
  /* The regression: switching the queue to a URL-driven scope silently
     replaced the priority ordering with created-desc, so a designer opening
     the queue no longer saw urgent work first. */
  it("puts urgent work first in the working queue", () => {
    for (const view of [
      "open",
      "in_progress",
      "needs_revision",
      "active",
    ] as const) {
      expect(defaultSortKeyFor(view)).toBe("priority");
      expect(sortToColumn(defaultSortKeyFor(view))).toEqual({
        field: "priority",
        direction: "desc",
      });
    }
  });

  it("puts the most overdue ticket first, by oldest due date", () => {
    expect(sortToColumn(defaultSortKeyFor("overdue"))).toEqual({
      field: "dueDate",
      direction: "asc",
      fixedDirection: true,
    });
  });

  it("falls back to newest-first everywhere else", () => {
    expect(sortToColumn(defaultSortKeyFor("all")).field).toBe("createdAt");
  });

  /* Every default must survive the same gate a hand-typed URL does, or a view
     can ship a sort the query layer silently discards. */
  it("only names sorts the query layer accepts", () => {
    for (const view of ADMIN_TICKET_VIEWS) {
      expect(isSortable(defaultSortKeyFor(view))).toBe(true);
    }
  });
});

describe("the lateness chip and the overdue count share one definition", () => {
  /* Found by clicking the page, not by a test: a draft past its due date wore
     a "9 days overdue" chip in the All list while the Overdue card correctly
     excluded it. An operator reading 6 on the dashboard and 7 chips in the
     list has no way to tell which number is lying. The row must resolve the
     same predicate the card counts. */
  const past = new Date("2026-08-25T12:00:00Z");

  /* Drives the SHIPPED function. Re-implementing the gate here is what let a
     previous version of this block pass while the page had no gate at all. */
  const chipShows = (row: Parameters<typeof matchesView>[0]) =>
    lateChipFor(row, NOW) !== null;

  it("shows no chip on a draft that is past its date", () => {
    expect(chipShows(ticket({ status: "draft", dueDate: past }))).toBe(false);
  });

  it("shows no chip on delivered work that is past its date", () => {
    expect(chipShows(ticket({ status: "delivered", dueDate: past }))).toBe(
      false,
    );
  });

  it("shows the chip on live work that is past its date", () => {
    for (const status of [
      "submitted",
      "assigned",
      "in_progress",
      "ready_for_review",
      "revision_requested",
    ] as const) {
      expect(chipShows(ticket({ status, dueDate: past }))).toBe(true);
    }
  });
});

/**
 * Row actions, exhaustively.
 *
 * `page.test.tsx` renders three statuses, so two of the four gates were never
 * reached: dropping the `designerId === null` clause from `claim`, or the
 * status exclusions from `start`, left the whole suite green. Both are silent
 * writes — Claim reassigns to the clicker with no confirmation, Start pulls a
 * ticket out of the client's review queue and emails them about it.
 */
describe("rowActionsFor", () => {
  const UNASSIGNED = null;
  const ASSIGNED = "11111111-1111-1111-1111-111111111111";

  /* A draft is the client's own unsubmitted request; signed-off work is
     finished. The studio writes to neither. */
  it.each(["draft", "delivered"] as const)(
    "offers no write on a %s ticket",
    (status) => {
      for (const designerId of [UNASSIGNED, ASSIGNED]) {
        expect(rowActionsFor(status, designerId)).toEqual({
          assign: false,
          claim: false,
          start: false,
          upload: false,
          remind: false,
        });
      }
    },
  );

  /* Claiming takes the ticket for yourself. On an assigned ticket that is
     silent reassignment away from whoever is carrying it. */
  it("offers Claim only when nobody is carrying the ticket", () => {
    expect(rowActionsFor("submitted", UNASSIGNED).claim).toBe(true);
    expect(rowActionsFor("submitted", ASSIGNED).claim).toBe(false);
    expect(rowActionsFor("revision_requested", ASSIGNED).claim).toBe(false);
  });

  /* Work already in progress is not a thing to start; work in review belongs
     to the CLIENT, and starting it pulls it back out of their queue. */
  it("does not offer Start on work already underway or in review", () => {
    expect(rowActionsFor("in_progress", ASSIGNED).start).toBe(false);
    expect(rowActionsFor("ready_for_review", ASSIGNED).start).toBe(false);
    expect(rowActionsFor("submitted", ASSIGNED).start).toBe(true);
    expect(rowActionsFor("assigned", ASSIGNED).start).toBe(true);
    expect(rowActionsFor("revision_requested", ASSIGNED).start).toBe(true);
  });

  it("offers Send reminder only where the designer is the blocker", () => {
    expect(rowActionsFor("in_progress", ASSIGNED).remind).toBe(true);
    // Nobody to reach.
    expect(rowActionsFor("in_progress", UNASSIGNED).remind).toBe(false);
    // Waiting on the client, not the designer.
    expect(rowActionsFor("ready_for_review", ASSIGNED).remind).toBe(false);
  });

  it("allows delivery uploads on every live status", () => {
    for (const status of [
      "submitted",
      "assigned",
      "in_progress",
      "ready_for_review",
      "revision_requested",
    ] as const) {
      expect(rowActionsFor(status, ASSIGNED).upload).toBe(true);
    }
  });

  /* Every status must be decided, not defaulted. */
  it("answers for every status in the enum", () => {
    for (const status of TICKET_STATUSES) {
      const actions = rowActionsFor(status, ASSIGNED);
      for (const value of Object.values(actions)) {
        expect(typeof value).toBe("boolean");
      }
    }
  });
});

/**
 * The predicate MEANINGS, pinned to literals.
 *
 * admin-tickets.test.ts derives its SQL expectations from VIEW_PREDICATES, so
 * mutating a predicate mutates the expectation with it and the translator
 * tests stay green. These assertions are the literal counterpart: widening
 * `approved` to include ready_for_review makes the Delivered card open a
 * larger list than the number it showed, and must fail here.
 */
describe("each view admits exactly the statuses it claims", () => {
  const admits = (view: Parameters<typeof matchesView>[1]) =>
    TICKET_STATUSES.filter((status) =>
      matchesView({ status, approvedAt: null, dueDate: null }, view, NOW),
    ).sort();

  it.each([
    ["approved", ["delivered"]],
    ["awaiting_review", ["ready_for_review"]],
    ["active", ["assigned", "in_progress", "ready_for_review"]],
    ["in_progress", ["assigned", "in_progress"]],
    ["needs_revision", ["revision_requested"]],
    [
      "open",
      [
        "assigned",
        "in_progress",
        "ready_for_review",
        "revision_requested",
        "submitted",
      ],
    ],
  ] as const)("%s", (view, expected) => {
    expect(admits(view)).toEqual([...expected].sort());
  });
});
