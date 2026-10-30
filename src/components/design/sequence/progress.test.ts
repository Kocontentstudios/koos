import { describe, expect, it } from "vitest";
import type { JobProgress } from "@/lib/generation/poll-job";
import { readSequenceProgress, sequenceProgressLine } from "./progress";

/* Exactly what run-design-sequence reports: {stage, done, total, label},
   total being the frame count. */
const sequence = (
  stage: "brief" | "render" | "checks",
  done: number,
  total = 5,
): JobProgress => ({ stage, done, total, label: "server text" });

describe("readSequenceProgress", () => {
  it("reads a sequence job's brief stage as planning", () => {
    expect(readSequenceProgress(sequence("brief", 0), "carousel")).toEqual({
      kind: "carousel",
      frameCount: 5,
      phase: "plan",
      done: 0,
    });
  });

  it("reads its render stage as frames delivered of the set", () => {
    expect(readSequenceProgress(sequence("render", 2), "carousel")).toEqual({
      kind: "carousel",
      frameCount: 5,
      phase: "render",
      done: 2,
    });
    expect(
      readSequenceProgress(sequence("checks", 6, 6), "presentation"),
    ).toMatchObject({ phase: "checks", frameCount: 6, done: 6 });
  });

  it("reads a set even when the entry point could not name its kind", () => {
    expect(readSequenceProgress(sequence("render", 1, 4), null)).toEqual({
      kind: null,
      frameCount: 4,
      phase: "render",
      done: 1,
    });
  });

  /* A directions run reports the same stages with a total of two (one for a
     regenerate). Read as a set, a flag-off carousel brief would be told
     "Planning your carousel…" while two directions are made. */
  it("leaves anything a directions run could send to the directions wait", () => {
    for (const total of [1, 2]) {
      expect(
        readSequenceProgress(sequence("brief", 0, total), "carousel"),
      ).toBeNull();
      expect(
        readSequenceProgress(sequence("render", 1, total), "carousel"),
      ).toBeNull();
    }
    expect(
      readSequenceProgress(
        { stage: "imagery", done: 0, total: 5, label: "" },
        "carousel",
      ),
    ).toBeNull();
  });

  it("ignores progress with no stage, which only the legacy path sends", () => {
    expect(
      readSequenceProgress({ done: 0, total: 4, label: "x" }, "carousel"),
    ).toBeNull();
  });

  it("never reports more frames done than the set has", () => {
    expect(readSequenceProgress(sequence("render", 9), "carousel")?.done).toBe(
      5,
    );
  });
});

describe("sequenceProgressLine", () => {
  const line = (
    phase: "plan" | "render" | "checks",
    done: number,
    kind: "carousel" | "presentation" | null = "carousel",
  ) => sequenceProgressLine({ kind, frameCount: 5, phase, done });

  it("says the set is being planned before any frame renders", () => {
    expect(line("plan", 0)).toBe("Planning your carousel…");
    expect(line("plan", 0, "presentation")).toBe("Planning your presentation…");
    expect(line("plan", 0, null)).toBe("Planning your slides…");
  });

  it("counts the frame being worked on, never past the last", () => {
    expect(line("render", 0)).toBe("Frame 1 of 5…");
    expect(line("render", 2)).toBe("Frame 3 of 5…");
    expect(line("render", 5)).toBe("Frame 5 of 5…");
  });

  it("says the set is being checked once every frame is drawn", () => {
    expect(line("checks", 5)).toBe("Checking your carousel…");
  });
});
