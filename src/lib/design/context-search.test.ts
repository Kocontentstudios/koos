import { describe, expect, it } from "vitest";
import {
  buildGroups,
  type ContextOption,
  groupKey,
  MAX_PER_GROUP,
  matchesQuery,
} from "@/lib/design/context-search";

const option = (over: Partial<ContextOption> = {}): ContextOption => ({
  type: "brief",
  id: "1",
  label: "Launch flyer brief",
  hint: "Flyer · 1080x1350",
  ...over,
});

describe("matchesQuery", () => {
  it("matches on the label, case-insensitively", () => {
    expect(matchesQuery(option(), "LAUNCH")).toBe(true);
    expect(matchesQuery(option(), "flyer")).toBe(true);
  });

  it("matches on the hint too, so a type or size finds a row", () => {
    expect(matchesQuery(option(), "1080")).toBe(true);
  });

  it("keeps everything for an empty or whitespace query", () => {
    expect(matchesQuery(option(), "")).toBe(true);
    expect(matchesQuery(option(), "   ")).toBe(true);
  });

  it("rejects a miss", () => {
    expect(matchesQuery(option(), "podcast")).toBe(false);
  });

  it("tolerates a missing hint", () => {
    expect(matchesQuery(option({ hint: null }), "launch")).toBe(true);
    expect(matchesQuery(option({ hint: null }), "1080")).toBe(false);
  });
});

describe("buildGroups", () => {
  it("groups by type and labels each group", () => {
    const groups = buildGroups(
      [option(), option({ type: "strategy", id: "2", label: "Q4 push" })],
      "",
    );
    expect(groups.map((g) => g.label)).toEqual([
      "Design briefs",
      "Campaign strategies",
    ]);
  });

  it("drops groups with no match rather than showing empty headings", () => {
    const groups = buildGroups(
      [
        option(),
        option({ type: "strategy", id: "2", label: "Q4 push", hint: null }),
      ],
      "flyer",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("brief");
  });

  /* One noisy category — a brand with 200 calendar items — must not push every
     other kind of context off the list. */
  it("caps each group independently", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      option({ type: "calendar_item", id: String(i), label: `Post ${i}` }),
    );
    const groups = buildGroups([...many, option()], "");
    const calendar = groups.find((g) => g.type === "calendar_item");
    expect(calendar?.options).toHaveLength(MAX_PER_GROUP);
    // The single brief still survives alongside them.
    expect(groups.find((g) => g.type === "brief")?.options).toHaveLength(1);
  });

  /* Ordering by match count would reshuffle the list under the user's cursor
     as they type. */
  it("keeps a fixed group order regardless of how many match", () => {
    const groups = buildGroups(
      [
        option({ type: "asset", id: "a", label: "logo.png" }),
        option({ type: "brief", id: "b" }),
        option({ type: "calendar_item", id: "c", label: "Friday post" }),
      ],
      "",
    );
    expect(groups.map((g) => g.type)).toEqual([
      "brief",
      "calendar_item",
      "asset",
    ]);
  });

  it("returns nothing when the query matches nothing", () => {
    expect(buildGroups([option()], "zzz")).toEqual([]);
  });
});

/* ── KOOS-BUG-016 ──────────────────────────────────────────────────────── */

const item = (
  id: string,
  label: string,
  calendarId?: string,
  calendarName?: string,
): ContextOption => ({
  type: "calendar_item",
  id,
  label,
  hint: null,
  ...(calendarId
    ? { groupId: calendarId, groupLabel: calendarName ?? calendarId }
    : {}),
});

describe("calendar items group by their calendar", () => {
  const across = [
    item("a1", "Launch teaser", "cal-1", "Harmattan launch"),
    item("a2", "Recipe reel", "cal-1", "Harmattan launch"),
    item("b1", "Referral post", "cal-2", "Referral drive"),
  ];

  it("makes one group per calendar", () => {
    const groups = buildGroups(across, "");
    const calendarGroups = groups.filter((g) => g.type === "calendar_item");
    expect(calendarGroups).toHaveLength(2);
    expect(calendarGroups.map((g) => g.label)).toEqual([
      "Harmattan launch",
      "Referral drive",
    ]);
  });

  /* The reported bug: briefs on any calendar but the newest were absent
     entirely. Every calendar's items must be reachable. */
  it("keeps every calendar's items, not just the first", () => {
    const ids = buildGroups(across, "")
      .filter((g) => g.type === "calendar_item")
      .flatMap((g) => g.options.map((o) => o.id));
    expect(ids).toEqual(expect.arrayContaining(["a1", "a2", "b1"]));
  });

  it("keeps the order the API returned, newest calendar first", () => {
    const labels = buildGroups(across, "")
      .filter((g) => g.type === "calendar_item")
      .map((g) => g.label);
    expect(labels[0]).toBe("Harmattan launch");
  });

  /* Every other type stays one flat group — only calendar items split. */
  it("does not split the other types", () => {
    const groups = buildGroups(
      [
        { type: "brief", id: "b1", label: "One", hint: null },
        { type: "brief", id: "b2", label: "Two", hint: null },
      ],
      "",
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].options).toHaveLength(2);
  });

  /* An item with no calendar must not vanish into a phantom group. */
  it("keeps ungrouped calendar items in one group", () => {
    const groups = buildGroups([item("x1", "Loose item")], "");
    expect(groups).toHaveLength(1);
    expect(groups[0].options.map((o) => o.id)).toEqual(["x1"]);
  });
});

describe("a capped group says what it is holding back", () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    item(`i${i}`, `Item ${i}`, "cal-1", "Harmattan launch"),
  );

  /* The other half of the bug: the picker sliced each group to 8 in silence,
     so a brand with 30 briefs saw a list that simply stopped. */
  it("reports the true total, not the number shown", () => {
    const [group] = buildGroups(many, "");
    expect(group.options).toHaveLength(MAX_PER_GROUP);
    expect(group.total).toBe(30);
  });

  it("shows everything once the group is expanded", () => {
    const key = groupKey("calendar_item", "cal-1");
    const [group] = buildGroups(many, "", undefined, new Set([key]));
    expect(group.options).toHaveLength(30);
    expect(group.total).toBe(30);
  });

  /* Expanding one group must not expand the others. */
  it("expands only the group that was opened", () => {
    const mixed = [
      ...many,
      ...Array.from({ length: 12 }, (_, i) =>
        item(`o${i}`, `Other ${i}`, "cal-2", "Referral drive"),
      ),
    ];
    const groups = buildGroups(
      mixed,
      "",
      undefined,
      new Set([groupKey("calendar_item", "cal-1")]),
    );
    const first = groups.find((g) => g.groupId === "cal-1");
    const second = groups.find((g) => g.groupId === "cal-2");
    expect(first?.options).toHaveLength(30);
    expect(second?.options).toHaveLength(MAX_PER_GROUP);
    expect(second?.total).toBe(12);
  });

  /* The count reflects what MATCHED, so a search narrows the total honestly
     rather than still claiming 30. */
  it("counts matches, not everything", () => {
    const [group] = buildGroups(many, "Item 1");
    // Item 1, and Item 10 through Item 19.
    expect(group.total).toBe(11);
  });

  it("gives every group a distinct expansion key", () => {
    expect(groupKey("calendar_item", "cal-1")).not.toBe(
      groupKey("calendar_item", "cal-2"),
    );
    expect(groupKey("brief")).toBe("brief");
  });
});
