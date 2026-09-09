import { describe, expect, it } from "vitest";
import {
  groupStrategiesForSidebar,
  type StrategyForSidebar,
} from "./sidebar-groups";

const row = (
  over: Partial<StrategyForSidebar> & { id: string },
): StrategyForSidebar => ({
  name: "Campaign",
  status: "draft",
  conversationId: null,
  updatedAt: new Date("2026-08-25T10:00:00.000Z"),
  ...over,
});

describe("groupStrategiesForSidebar", () => {
  it("points a chat at its newest live strategy", () => {
    const { strategyIdByConversation } = groupStrategiesForSidebar(
      [
        row({ id: "s2", conversationId: "c1" }),
        row({ id: "s1", conversationId: "c1" }),
      ],
      [{ id: "c1" }],
    );
    expect(strategyIdByConversation.get("c1")).toBe("s2");
  });

  /* Regression: archiving used to bump updatedAt, which sorted a superseded
     version above the version that superseded it. The chat's badge then
     pointed at an archived row and the real campaign fell into "Older
     Strategies" — the same campaign listed three times. */
  it("never points a chat at an archived version", () => {
    const { strategyIdByConversation, olderStrategies } =
      groupStrategiesForSidebar(
        [
          row({
            id: "old",
            conversationId: "c1",
            status: "archived",
            updatedAt: new Date("2026-08-25T12:00:00.000Z"),
          }),
          row({
            id: "current",
            conversationId: "c1",
            status: "active",
            updatedAt: new Date("2026-08-25T11:00:00.000Z"),
          }),
        ],
        [{ id: "c1" }],
      );
    expect(strategyIdByConversation.get("c1")).toBe("current");
    expect(olderStrategies).toEqual([]);
  });

  it("lists a strategy with no chat under Older Strategies", () => {
    const { olderStrategies } = groupStrategiesForSidebar(
      [row({ id: "orphan" })],
      [],
    );
    expect(olderStrategies.map((s) => s.id)).toEqual(["orphan"]);
  });

  it("lists a strategy whose chat fell off the recent list", () => {
    const { olderStrategies } = groupStrategiesForSidebar(
      [row({ id: "s1", conversationId: "c-stale" })],
      [{ id: "c1" }],
    );
    expect(olderStrategies.map((s) => s.id)).toEqual(["s1"]);
  });

  it("hides archived versions from Older Strategies", () => {
    const { olderStrategies } = groupStrategiesForSidebar(
      [row({ id: "gone", status: "archived" })],
      [],
    );
    expect(olderStrategies).toEqual([]);
  });

  it("keeps a superseded-but-live version reachable", () => {
    const { olderStrategies } = groupStrategiesForSidebar(
      [
        row({ id: "s2", conversationId: "c1" }),
        row({ id: "s1", conversationId: "c1" }),
      ],
      [{ id: "c1" }],
    );
    expect(olderStrategies.map((s) => s.id)).toEqual(["s1"]);
  });

  it("handles a brand with no strategies", () => {
    const { olderStrategies, strategyIdByConversation } =
      groupStrategiesForSidebar([], [{ id: "c1" }]);
    expect(olderStrategies).toEqual([]);
    expect(strategyIdByConversation.size).toBe(0);
  });
});
