import { describe, expect, it } from "vitest";
import { readSequenceProgress, sequenceProgressLine } from "./progress";

const base = { done: 0, total: 5, label: "anything" };

describe("readSequenceProgress", () => {
  it("is null for a directions job, which reports no sequence mark", () => {
    expect(readSequenceProgress(base)).toBeNull();
    expect(readSequenceProgress({ ...base, stage: "render" })).toBeNull();
  });

  it("reads the mark a sequence job adds", () => {
    expect(
      readSequenceProgress({
        ...base,
        done: 2,
        sequence: { kind: "carousel", frameCount: 5, phase: "render" },
      } as never),
    ).toEqual({ kind: "carousel", frameCount: 5, phase: "render", done: 2 });
  });

  it("refuses a malformed mark rather than guessing", () => {
    for (const sequence of [
      { kind: "video", frameCount: 5, phase: "render" },
      { kind: "carousel", frameCount: 0, phase: "render" },
      { kind: "carousel", frameCount: 5, phase: "drawing" },
      "carousel",
    ]) {
      expect(readSequenceProgress({ ...base, sequence } as never)).toBeNull();
    }
  });

  it("never reports more frames done than the set has", () => {
    const p = readSequenceProgress({
      ...base,
      done: 9,
      sequence: { kind: "carousel", frameCount: 5, phase: "render" },
    } as never);
    expect(p?.done).toBe(5);
  });
});

describe("sequenceProgressLine", () => {
  it("says the set is being planned before any frame renders", () => {
    expect(
      sequenceProgressLine({
        kind: "carousel",
        frameCount: 5,
        phase: "plan",
        done: 0,
      }),
    ).toBe("Planning your carousel…");
    expect(
      sequenceProgressLine({
        kind: "presentation",
        frameCount: 6,
        phase: "plan",
        done: 0,
      }),
    ).toBe("Planning your presentation…");
  });

  it("counts the frame being worked on, never past the last", () => {
    const at = (done: number) =>
      sequenceProgressLine({
        kind: "carousel",
        frameCount: 5,
        phase: "render",
        done,
      });
    expect(at(0)).toBe("Frame 1 of 5…");
    expect(at(2)).toBe("Frame 3 of 5…");
    expect(at(5)).toBe("Frame 5 of 5…");
  });
});
