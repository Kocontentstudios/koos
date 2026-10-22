import { describe, expect, it, vi } from "vitest";
import {
  SUBJECT_COVERED,
  SUBJECT_CROPPED,
} from "@/lib/design/document/subject";
import type { DesignSpec } from "@/lib/design/spec";
import { draftOf } from "./fixtures";
import { designSpecOf } from "./schema";
import { chooseLayout } from "./subject-layout";

const spec = designSpecOf({
  ...draftOf({ layout: "hero-center" }),
  aspectRatio: "4:5",
  rationale: ["a", "b"],
  title: "t",
} as never) as DesignSpec;
const relayout = (s: DesignSpec, layout: DesignSpec["layout"]) => ({
  ...s,
  layout,
});
const whole = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
const face = { x: 0.4, y: 0.1, w: 0.2, h: 0.2 };

describe("chooseLayout", () => {
  it("keeps the proposed layout when it keeps the copy off the subject", async () => {
    const faultOf = vi.fn(async () => null);
    const choice = await chooseLayout({
      spec,
      held: [],
      subjects: [whole],
      faultOf,
      relayout,
    });
    expect(choice).toMatchObject({ fault: null, subject: whole, tried: 1 });
    expect(choice.spec.layout).toBe("hero-center");
  });

  /* Round-2 live critic: the headline sat on the pastry in three of four
     hero and stat renders. */
  it("moves to the next free layout when copy would cover the subject", async () => {
    const faultOf = vi.fn(async (s: DesignSpec) =>
      s.layout === "hero-center" || s.layout === "split-left"
        ? SUBJECT_COVERED
        : null,
    );
    const choice = await chooseLayout({
      spec,
      held: ["split-left"],
      subjects: [whole],
      faultOf,
      relayout,
    });
    expect(choice.spec.layout).toBe("banner-bottom");
    expect(choice.fault).toBeNull();
    expect(faultOf).not.toHaveBeenCalledWith(
      expect.objectContaining({ layout: "split-left" }),
      expect.anything(),
    );
  });

  it("keeps a person's face clear when the whole person leaves no room", async () => {
    const faultOf = vi.fn(async (_s: DesignSpec, subject: typeof whole) =>
      subject === whole ? SUBJECT_COVERED : null,
    );
    const choice = await chooseLayout({
      spec,
      held: [],
      subjects: [whole, face],
      faultOf,
      relayout,
    });
    expect(choice).toMatchObject({ subject: face, fault: null });
  });

  it("prefers a small subject to a covered one, and reports it", async () => {
    const faultOf = vi.fn(async (s: DesignSpec) =>
      s.layout === "quote-card" ? SUBJECT_CROPPED : SUBJECT_COVERED,
    );
    const choice = await chooseLayout({
      spec,
      held: [],
      subjects: [whole],
      faultOf,
      relayout,
    });
    expect(choice.spec.layout).toBe("quote-card");
    expect(choice.fault).toBe(SUBJECT_CROPPED);
  });

  it("says so when no layout keeps the copy off the subject", async () => {
    const choice = await chooseLayout({
      spec,
      held: [],
      subjects: [whole],
      faultOf: async () => SUBJECT_COVERED,
      relayout,
    });
    expect(choice.fault).toBe(SUBJECT_COVERED);
    expect(choice.tried).toBe(5);
  });

  it("builds nothing without a known subject, and still avoids held layouts", async () => {
    const faultOf = vi.fn();
    const choice = await chooseLayout({
      spec,
      held: ["hero-center"],
      subjects: [null],
      faultOf,
      relayout,
    });
    expect(faultOf).not.toHaveBeenCalled();
    expect(choice.spec.layout).toBe("split-left");
  });
});
