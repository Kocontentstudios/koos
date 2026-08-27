import { describe, expect, it } from "vitest";
import {
  buildGroups,
  type ContextOption,
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
