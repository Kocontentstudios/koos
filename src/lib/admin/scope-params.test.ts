import { describe, expect, it } from "vitest";
import { ADMIN_TICKET_VIEWS } from "./scope";
import { adminScopeHref, DEFAULT_SCOPE, loadAdminScope } from "./scope-params";

const parse = (qs: string) => loadAdminScope(new URLSearchParams(qs));

describe("reading a scope off the URL", () => {
  it("falls back to the defaults for an empty query", () => {
    expect(parse("")).toEqual(DEFAULT_SCOPE);
  });

  it("reads the whole vocabulary", () => {
    const s = parse(
      "view=overdue&status=submitted,assigned&assignee=unassigned&brand=b1&q=DT-124&range=custom&from=2026-07-19&to=2026-07-25&on=due&page=3",
    );
    expect(s.view).toBe("overdue");
    expect(s.status).toEqual(["submitted", "assigned"]);
    expect(s.assignee).toBe("unassigned");
    expect(s.brand).toBe("b1");
    expect(s.q).toBe("DT-124");
    expect(s.range).toBe("custom");
    expect(s.from).toBe("2026-07-19");
    expect(s.to).toBe("2026-07-25");
    expect(s.on).toBe("due");
    expect(s.page).toBe(3);
  });

  /* A hand-edited or stale URL is data, not a crash. Every unknown value falls
     back rather than throwing a 500 on a page an admin bookmarked. */
  it.each([
    ["view=nonsense", "view"],
    ["range=forever", "range"],
    ["on=whenever", "on"],
    ["sort=createdAt;DROP TABLE", "sort"],
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
      brand: "b1",
      assignee: "u9",
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
      brand: "b1",
      assignee: "u9",
      range: "7d" as const,
      status: ["submitted" as const],
    };
    const href = adminScopeHref("/admin/analytics/records", scope, {
      kind: ["design_generated"],
    });
    const back = loadAdminScope(new URLSearchParams(href.split("?")[1]));

    expect(back.brand).toBe("b1");
    expect(back.assignee).toBe("u9");
    expect(back.range).toBe("7d");
    expect(back.status).toEqual(["submitted"]);
    expect(back.kind).toEqual(["design_generated"]);
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
