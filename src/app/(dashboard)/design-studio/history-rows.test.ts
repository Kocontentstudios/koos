import { describe, expect, it, vi } from "vitest";
import type { designGenerations } from "@/lib/db/schema";
import { historyRows } from "./history-rows";

type Row = typeof designGenerations.$inferSelect;

function row(id: string, overrides: Partial<Row> = {}, minute = 0): Row {
  return {
    id,
    setId: null,
    frameIndex: null,
    frameCount: null,
    supersededBy: null,
    status: "succeeded",
    createdAt: new Date(Date.UTC(2026, 9, 30, 10, minute)),
    ...overrides,
  } as Row;
}

const frame = (id: string, index: number, extra: Partial<Row> = {}) =>
  row(
    id,
    { setId: "set-1", frameIndex: index, frameCount: 3, ...extra },
    index,
  );

describe("historyRows", () => {
  it("leaves a history with no sets exactly as it was", async () => {
    const newest = [row("a"), row("b")];
    const setFrames = vi.fn();
    expect(await historyRows(newest, setFrames)).toEqual(newest);
    expect(setFrames).not.toHaveBeenCalled();
  });

  /* The page of 24 cut the carousel: only frame 2 made it in. The set comes
     back whole, at the place its newest row held. */
  it("makes a set cut by the page whole, in its newest row's place", async () => {
    const all = [frame("f0", 0), frame("f1", 1), frame("f2", 2)];
    const out = await historyRows(
      [row("newer"), frame("f2", 2), row("older")],
      async () => all,
    );
    expect(out.map((r) => r.id)).toEqual(["newer", "f0", "f1", "f2", "older"]);
  });

  it("shows only the frames on show, never a replaced one", async () => {
    const all = [
      frame("f0", 0),
      frame("f1-old", 1, { supersededBy: "f1-new" }),
      frame("f1-new", 1, { createdAt: new Date(Date.UTC(2026, 9, 30, 11)) }),
      frame("f2", 2, { status: "failed" }),
    ];
    const out = await historyRows([frame("f1-new", 1)], async () => all);
    expect(out.map((r) => r.id)).toEqual(["f0", "f1-new", "f2"]);
  });

  it("asks for each set once however many of its rows are on the page", async () => {
    const setFrames = vi.fn(async () => [frame("f0", 0), frame("f1", 1)]);
    const out = await historyRows([frame("f1", 1), frame("f0", 0)], setFrames);
    expect(setFrames).toHaveBeenCalledTimes(1);
    expect(setFrames).toHaveBeenCalledWith("set-1");
    expect(out.map((r) => r.id)).toEqual(["f0", "f1"]);
  });
});
