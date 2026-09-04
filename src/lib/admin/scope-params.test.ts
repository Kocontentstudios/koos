import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TICKET_STATUSES } from "@/lib/design/tickets-ui";
import { ADMIN_TICKET_VIEWS, matchesView } from "./scope";
import {
  adminScopeHref,
  DEFAULT_SCOPE,
  loadAdminScope,
  statusRowHref,
} from "./scope-params";

const parse = (qs: string) => loadAdminScope(new URLSearchParams(qs));

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const DESIGNER = "11111111-1111-1111-1111-111111111111";

describe("reading a scope off the URL", () => {
  it("falls back to the defaults for an empty query", () => {
    expect(parse("")).toEqual(DEFAULT_SCOPE);
  });

  it("reads the whole vocabulary", () => {
    const s = parse(
      `view=overdue&status=submitted,assigned&assignee=unassigned&brand=${BRAND}&q=DT-124&range=custom&from=2026-07-19&to=2026-07-25&on=due&page=3`,
    );
    expect(s.view).toBe("overdue");
    expect(s.status).toEqual(["submitted", "assigned"]);
    expect(s.assignee).toBe("unassigned");
    expect(s.brand).toBe(BRAND);
    expect(s.q).toBe("DT-124");
    expect(s.range).toBe("custom");
    expect(s.from).toBe("2026-07-19");
    expect(s.to).toBe("2026-07-25");
    expect(s.on).toBe("due");
    expect(s.page).toBe(3);
  });

  /* A hand-edited or stale URL is data, not a crash. Every unknown value falls
     back rather than throwing a 500 on a page an admin bookmarked. */
  /* Every one of these reaches SQL. A brand or assignee that is not a uuid is
     a query ERROR in Postgres, not a miss, so `?brand=acme` threw out of the
     server component into the error boundary. */
  it.each([
    ["view=nonsense", "view"],
    ["range=forever", "range"],
    ["on=whenever", "on"],
    ["sort=createdAt;DROP TABLE", "sort"],
    ["brand=acme", "brand"],
    ["assignee=not-a-uuid", "assignee"],
    ["requester=1 OR 1=1", "requester"],
  ])("drops junk in %s rather than erroring", (qs, key) => {
    const s = parse(qs) as Record<string, unknown>;
    expect(s[key]).toEqual((DEFAULT_SCOPE as Record<string, unknown>)[key]);
  });

  it("keeps only statuses that exist in the enum", () => {
    expect(parse("status=submitted,made_up,delivered").status).toEqual([
      "submitted",
      "delivered",
    ]);
  });

  it("clamps a nonsense page", () => {
    expect(parse("page=0").page).toBe(1);
    expect(parse("page=-4").page).toBe(1);
    expect(parse("page=abc").page).toBe(1);
  });
});

describe("building a link from a scope", () => {
  it("omits defaults so two routes to the same view produce one URL", () => {
    expect(adminScopeHref("/admin/tickets", DEFAULT_SCOPE)).toBe(
      "/admin/tickets",
    );
  });

  it("round-trips a scope through the URL unchanged", () => {
    const scope = {
      ...DEFAULT_SCOPE,
      view: "overdue" as const,
      brand: BRAND,
      assignee: DESIGNER,
      range: "7d" as const,
      status: ["submitted" as const],
      page: 2,
    };
    const href = adminScopeHref("/admin/tickets", scope);
    expect(loadAdminScope(new URLSearchParams(href.split("?")[1]))).toEqual(
      scope,
    );
  });

  /* This is the whole design in one assertion. "Preserve the active filters"
     is not a per-link decision: every clickable element carries the entire
     scope and patches one key, so there is no link that can forget one. */
  it("carries the whole scope and changes only what was patched", () => {
    const scope = {
      ...DEFAULT_SCOPE,
      brand: BRAND,
      assignee: DESIGNER,
      range: "7d" as const,
      status: ["submitted" as const],
    };
    const href = adminScopeHref("/admin/tickets", scope, {
      view: "overdue",
    });
    const back = loadAdminScope(new URLSearchParams(href.split("?")[1]));

    expect(back.brand).toBe(BRAND);
    expect(back.assignee).toBe(DESIGNER);
    expect(back.range).toBe("7d");
    expect(back.status).toEqual(["submitted"]);
    expect(back.view).toBe("overdue");
  });

  /* The bug this pins: with `all` as the parser default, the serializer
     dropped ?view=all from the href, the page read the bare URL back as the
     default, and an explicit "All" click landed on Open. Drafts and delivered
     tickets were then unreachable from the tab bar. Every view has to survive
     the round trip the tab bar actually performs. */
  it.each([...ADMIN_TICKET_VIEWS])(
    "round-trips ?view=%s through a tab link",
    (view) => {
      const href = adminScopeHref("/admin/tickets", DEFAULT_SCOPE, {
        view,
        page: 1,
      });
      const back = loadAdminScope(
        new URLSearchParams(href.split("?")[1] ?? ""),
      );
      expect(back.view).toBe(view);
    },
  );

  /* The bare queue URL is the working queue, not everything ever filed. */
  it("reads the bare ticket URL as the open queue", () => {
    expect(parse("").view).toBe("open");
    expect(DEFAULT_SCOPE.view).toBe("open");
  });

  it("writes multi-values as one comma list, not repeated keys", () => {
    const href = adminScopeHref("/admin/tickets", {
      ...DEFAULT_SCOPE,
      status: ["submitted", "assigned"],
    });
    expect(href).toContain("status=submitted,assigned");
    expect(href.match(/status=/g)).toHaveLength(1);
  });
});

describe("a status row opens exactly the tickets it counted", () => {
  /* The bug this exists to stop, found by clicking the page rather than by any
     unit test: the href was hand-built as `?status=delivered`, so it inherited
     whatever the parser's default view was. When that default became `open`
     — NOT IN (draft, delivered) — the link resolved to an empty set and the
     Approved row showed 1 but opened 0.

     Asserting the RESOLVED SCOPE rather than the string is what makes this
     catchable: the defect was entirely in what the URL meant, not how it
     looked. */
  /* Delivered and approved work has left the queue, so those two rows open
     Delivered Projects — the whole point of ADMIN-FEAT-002. Everything else
     stays on the ticket list. */
  it("sends work that has left the queue to Delivered Projects", () => {
    expect(statusRowHref("delivered")).toContain("/admin/delivered");
    expect(statusRowHref("ready_for_review")).toContain("/admin/delivered");
  });

  it("keeps live work on the ticket list", () => {
    for (const status of [
      "draft",
      "submitted",
      "assigned",
      "in_progress",
      "revision_requested",
    ] as const) {
      expect(statusRowHref(status)).toContain("/admin/tickets");
    }
  });

  it.each([...TICKET_STATUSES])(
    "resolves ?status=%s to a scope that can return that status",
    (status) => {
      const scope = loadAdminScope(
        new URLSearchParams(statusRowHref(status).split("?")[1] ?? ""),
      );
      expect(scope.status).toEqual([status]);

      const row = { status, approvedAt: null, dueDate: null };
      expect(matchesView(row, scope.view, new Date())).toBe(true);
    },
  );

  /* The WHOLE path, not just its first segment: /admin/tickets/nonexistent
     shares a segment with a real route and 404s all the same. A directory with
     a page.tsx is a route; anything else is not. */
  it("never points at a route the app does not serve", () => {
    const appDir = join(process.cwd(), "src/app");

    function isRoute(pathname: string): boolean {
      const dir = join(appDir, pathname);
      return (
        existsSync(join(dir, "page.tsx")) || existsSync(join(dir, "page.ts"))
      );
    }

    for (const status of TICKET_STATUSES) {
      const pathname = statusRowHref(status).split("?")[0] ?? "";
      expect(isRoute(pathname)).toBe(true);
    }
    // The check itself must be able to fail.
    expect(isRoute("/admin/definitely-not-a-route")).toBe(false);
  });
});

describe("uuid params never reach a uuid column malformed", () => {
  it("keeps a real uuid", () => {
    expect(parse(`brand=${BRAND}`).brand).toBe(BRAND);
    expect(parse(`assignee=${DESIGNER}`).assignee).toBe(DESIGNER);
  });

  /* The one non-uuid value the query layer understands: it maps to
     `assigned_designer_id IS NULL`, never to a comparison. */
  it("keeps the unassigned sentinel", () => {
    expect(parse("assignee=unassigned").assignee).toBe("unassigned");
  });

  it("does not extend the sentinel to the other uuid params", () => {
    expect(parse("brand=unassigned").brand).toBe("");
    expect(parse("requester=unassigned").requester).toBe("");
  });
});
