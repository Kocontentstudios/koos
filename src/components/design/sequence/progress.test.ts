import { describe, expect, it } from "vitest";
import {
  sequenceMarkFor,
  sequenceMarkOf,
} from "@/lib/design/sequence/progress-mark";
import type { JobProgress } from "@/lib/generation/poll-job";
import {
  plannedProgress,
  readSequenceProgress,
  sequenceProgressLine,
} from "./progress";

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
     regenerate). With nothing naming a set, reading it as one would tell a
     directions run "Planning your slides…". */
  it("leaves anything a directions run could send to the directions wait", () => {
    for (const total of [1, 2]) {
      expect(
        readSequenceProgress(sequence("brief", 0, total), null),
      ).toBeNull();
      expect(
        readSequenceProgress(sequence("render", 1, total), null),
      ).toBeNull();
    }
    expect(
      readSequenceProgress(sequence("brief", 0, 1), "carousel"),
    ).toBeNull();
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

  /* FRAME_BOUNDS.carousel.min is 2: a valid two-slide carousel must not wait
     under "Creating two directions". */
  it("reads a two-frame carousel as a set once its kind is known", () => {
    expect(readSequenceProgress(sequence("brief", 0, 2), "carousel")).toEqual({
      kind: "carousel",
      frameCount: 2,
      phase: "plan",
      done: 0,
    });
  });

  it("takes the job's own mark over anything the entry point said", () => {
    const marked = {
      ...sequence("render", 1, 2),
      ...sequenceMarkFor("carousel", "set-1"),
    };
    expect(readSequenceProgress(marked, null)).toEqual({
      kind: "carousel",
      frameCount: 2,
      phase: "render",
      done: 1,
    });
    const presentation = {
      ...sequence("brief", 0, 3),
      ...sequenceMarkFor("presentation"),
    };
    expect(readSequenceProgress(presentation, "carousel")?.kind).toBe(
      "presentation",
    );
  });

  it("ignores a mark that names no kind it knows", () => {
    expect(
      readSequenceProgress(
        { ...sequence("brief", 0, 2), sequenceKind: "poster" } as JobProgress,
        null,
      ),
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

  it("plans a known set before the job has reported its count", () => {
    const seeded = plannedProgress("carousel");
    expect(seeded).toEqual({
      kind: "carousel",
      frameCount: null,
      phase: "plan",
      done: 0,
    });
    expect(sequenceProgressLine(seeded)).toBe("Planning your carousel…");
    expect(sequenceProgressLine({ ...seeded, phase: "render", done: 1 })).toBe(
      "Frame 2…",
    );
  });
});

describe("sequenceMarkOf", () => {
  it("reads the kind and set the job stamped on its progress", () => {
    expect(sequenceMarkOf({ sequenceKind: "carousel", setId: "s1" })).toEqual({
      sequenceKind: "carousel",
      setId: "s1",
    });
    expect(sequenceMarkOf({ sequenceKind: "presentation", setId: "" })).toEqual(
      { sequenceKind: "presentation" },
    );
    expect(sequenceMarkOf({ stage: "brief" })).toBeNull();
    expect(sequenceMarkOf(null)).toBeNull();
  });
});
