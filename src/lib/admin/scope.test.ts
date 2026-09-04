import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TICKET_STATUSES } from "@/lib/design/tickets-ui";
import {
  ADMIN_TICKET_VIEWS,
  type AdminTicketView,
  clampPage,
  defaultSortKeyFor,
  formatOverdue,
  isSortable,
  matchesView,
  overdueMs,
  pageCount,
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
  it("approved and completed select the same tickets", () => {
    const shapes: Row[] = [
      ticket({ status: "draft" }),
      ticket({ status: "in_progress" }),
      ticket({ status: "ready_for_review" }),
      ticket({ status: "delivered" }),
      ticket({ status: "delivered", approvedAt: new Date("2026-08-01") }),
      ticket({ status: "revision_requested" }),
    ];
    for (const r of shapes) {
      expect(matchesView(r, "completed", NOW)).toBe(
        matchesView(r, "approved", NOW),
      );
    }
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
  /* A status row's number is grouped on the raw status, so its link has to be
     the plain status filter or the list contradicts the count that was
     clicked. */
  it("opens exactly the status it names", () => {
    for (const s of TICKET_STATUSES) {
      expect(statusRowHref(s)).toBe(`/admin/tickets?status=${s}`);
    }
  });

  /* The regression this exists to stop: a href pointing at a segment nobody
     built, which ships green and 404s on the first click. */
  it("never points at a route the app does not serve", () => {
    const segments = readdirSync(join(process.cwd(), "src/app/admin"), {
      withFileTypes: true,
    })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    for (const s of TICKET_STATUSES) {
      const path = statusRowHref(s).split("?")[0] ?? "";
      const segment = path.replace("/admin/", "").split("/")[0] ?? "";
      expect(segments).toContain(segment);
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
    expect(w.to.toISOString()).toBe("2026-07-26T00:00:00.000Z");
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

  it("puts the latest ticket first in the overdue list", () => {
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
