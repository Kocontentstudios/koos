import { describe, expect, it } from "vitest";
import { frameRationale, liveFrames, serializedFrameOf } from "./frames";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 30, 12, minute));

function row(
  id: string,
  frameIndex: number,
  status: "pending" | "succeeded" | "failed",
  minute: number,
  supersededBy: string | null = null,
) {
  return { id, frameIndex, status, createdAt: at(minute), supersededBy };
}

describe("liveFrames", () => {
  it("keeps one row per index, in frame order", () => {
    const live = liveFrames([
      row("b", 1, "succeeded", 1),
      row("a", 0, "succeeded", 1),
      row("c", 2, "succeeded", 1),
    ]);
    expect(live.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("drops a superseded frame for its replacement", () => {
    const live = liveFrames([
      row("old", 1, "succeeded", 1, "new"),
      row("new", 1, "succeeded", 5),
    ]);
    expect(live.map((r) => r.id)).toEqual(["new"]);
  });

  it("keeps showing the frame a pending or failed regenerate would replace", () => {
    expect(
      liveFrames([row("old", 0, "succeeded", 1), row("new", 0, "pending", 5)]),
    ).toEqual([expect.objectContaining({ id: "old" })]);
    expect(
      liveFrames([row("old", 0, "succeeded", 1), row("new", 0, "failed", 5)]),
    ).toEqual([expect.objectContaining({ id: "old" })]);
  });

  it("leaves out an index with no row", () => {
    const live = liveFrames([
      row("a", 0, "succeeded", 1),
      row("c", 2, "succeeded", 1),
    ]);
    expect(live.map((r) => r.frameIndex)).toEqual([0, 2]);
  });
});

describe("serializedFrameOf", () => {
  it("is null on a single design", () => {
    expect(
      serializedFrameOf({
        setId: null,
        frameIndex: null,
        frameCount: null,
        rationale: null,
      }),
    ).toBeNull();
  });

  it("reads a frame's role and title back", () => {
    const rationale = frameRationale({
      role: "cta",
      title: "Book now",
      headline: "h",
      subheadline: "",
      cta: "Book",
      footerLines: [],
      layout: "hero-center",
      showsImage: false,
      backgroundPrompt: "",
    });
    expect(
      serializedFrameOf({
        setId: "s",
        frameIndex: 4,
        frameCount: 5,
        rationale,
      }),
    ).toEqual({
      setId: "s",
      index: 4,
      count: 5,
      role: "cta",
      title: "Book now",
    });
  });

  it("has no set on its rationale, so the directions regenerate refuses it", () => {
    const rationale = frameRationale({
      role: "hook",
      title: "t",
      headline: "h",
      subheadline: "",
      cta: "",
      footerLines: [],
      layout: "hero-center",
      showsImage: true,
      backgroundPrompt: "",
    });
    expect("set" in rationale).toBe(false);
  });
});
