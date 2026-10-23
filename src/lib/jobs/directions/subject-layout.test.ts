import { describe, expect, it, vi } from "vitest";
import {
  SUBJECT_COVERED,
  SUBJECT_CROPPED,
  type SubjectBox,
} from "@/lib/design/document/subject";
import type { DesignSpec } from "@/lib/design/spec";
import { HEADLINE_NOT_LEADING, HEADLINE_UNDER_COPY } from "./craft";
import { draftOf } from "./fixtures";
import { designSpecOf } from "./schema";
import {
  chooseLayout,
  LAYOUT_CRAFT_FAILED,
  LayoutsHeldError,
  type LayoutVerdict,
  SUBJECT_FACE_ONLY,
} from "./subject-layout";

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

const verdict = (
  subjectFault: string | null,
  craft: Partial<LayoutVerdict["craft"]> = {},
): LayoutVerdict => ({
  subjectFault,
  craft: { hard: null, soft: null, ...craft },
});

describe("chooseLayout", () => {
  it("keeps the proposed layout when it keeps the copy off the subject", async () => {
    const judge = vi.fn(async () => verdict(null));
    const choice = await chooseLayout({
      spec,
      held: [],
      subjects: [whole],
      judge,
      relayout,
    });
    expect(choice).toMatchObject({
      fault: null,
      faults: [],
      subject: whole,
      wholeSubject: whole,
      tried: 1,
    });
    expect(choice.spec.layout).toBe("hero-center");
  });

  /* Round-2 live critic: the headline sat on the pastry in three of four
     hero and stat renders. */
  it("moves to the next free layout when copy would cover the subject", async () => {
    const judge = vi.fn(async (s: DesignSpec) =>
      verdict(
        s.layout === "hero-center" || s.layout === "split-left"
          ? SUBJECT_COVERED
          : null,
      ),
    );
    const choice = await chooseLayout({
      spec,
      held: ["split-left"],
      subjects: [whole],
      judge,
      relayout,
    });
    expect(choice.spec.layout).toBe("banner-bottom");
    expect(choice.fault).toBeNull();
    expect(judge).not.toHaveBeenCalledWith(
      expect.objectContaining({ layout: "split-left" }),
      expect.anything(),
    );
  });

  /* Round-3 code critic: the head-and-shoulders fallback laid the headline
     across a tray of croissants and recorded nothing. */
  it("records a fault when only a person's face can be kept clear", async () => {
    const judge = vi.fn(async (_s: DesignSpec, subject: SubjectBox | null) =>
      verdict(subject === whole ? SUBJECT_COVERED : null),
    );
    const choice = await chooseLayout({
      spec,
      held: [],
      subjects: [whole, face],
      judge,
      relayout,
    });
    expect(choice).toMatchObject({
      subject: face,
      wholeSubject: whole,
      fault: SUBJECT_FACE_ONLY,
    });
  });

  it("prefers the whole subject cropped to only the face kept clear", async () => {
    const judge = vi.fn(async (s: DesignSpec, subject: SubjectBox | null) =>
      verdict(
        subject === face
          ? null
          : s.layout === "quote-card"
            ? SUBJECT_CROPPED
            : SUBJECT_COVERED,
      ),
    );
    const choice = await chooseLayout({
      spec,
      held: [],
      subjects: [whole, face],
      judge,
      relayout,
    });
    expect(choice.spec.layout).toBe("quote-card");
    expect(choice.subject).toBe(whole);
    expect(choice.fault).toBe(SUBJECT_CROPPED);
  });

  it("says so when no layout keeps the copy off the subject", async () => {
    const choice = await chooseLayout({
      spec,
      held: [],
      subjects: [whole],
      judge: async () => verdict(SUBJECT_COVERED),
      relayout,
    });
    expect(choice.fault).toBe(SUBJECT_COVERED);
    expect(choice.tried).toBe(5);
  });

  /* Round-3 live critic: a quote card with a 21 px headline under a 28 px
     footer and its button across the card's edge was delivered. */
  it("never takes a layout with a hard craft fault", async () => {
    const judge = vi.fn(async (s: DesignSpec) =>
      verdict(null, {
        hard: s.layout === "hero-center" ? HEADLINE_UNDER_COPY : null,
      }),
    );
    const choice = await chooseLayout({
      spec,
      held: [],
      subjects: [null],
      judge,
      relayout,
    });
    expect(choice.spec.layout).not.toBe("hero-center");
    expect(choice.fault).toBeNull();
  });

  it("fails as a copy problem when every layout has a hard craft fault", async () => {
    const choice = await chooseLayout({
      spec,
      held: [],
      subjects: [whole],
      judge: async () => verdict(null, { hard: HEADLINE_UNDER_COPY }),
      relayout,
    });
    expect(choice.fault).toBe(LAYOUT_CRAFT_FAILED);
  });

  it("delivers a soft craft fault only when no layout avoids it, and says so", async () => {
    const judge = vi.fn(async (s: DesignSpec) =>
      verdict(null, {
        soft: s.layout === "stat-highlight" ? null : HEADLINE_NOT_LEADING,
      }),
    );
    const clean = await chooseLayout({
      spec,
      held: [],
      subjects: [null],
      judge,
      relayout,
    });
    expect(clean.spec.layout).toBe("stat-highlight");
    const soft = await chooseLayout({
      spec,
      held: ["stat-highlight"],
      subjects: [null],
      judge,
      relayout,
    });
    expect(soft.fault).toBe(HEADLINE_NOT_LEADING);
  });

  it("judges craft without a known subject, and still avoids held layouts", async () => {
    const judge = vi.fn(async () => verdict(null));
    const choice = await chooseLayout({
      spec,
      held: ["hero-center"],
      subjects: [],
      judge,
      relayout,
    });
    expect(judge).toHaveBeenCalledWith(
      expect.objectContaining({ layout: "split-left" }),
      null,
    );
    expect(choice.spec.layout).toBe("split-left");
  });

  /* Round-3 code critic P5: with every layout held it fell back to a held
     one. */
  it("refuses rather than reuse a held layout", async () => {
    await expect(
      chooseLayout({
        spec,
        held: [
          "hero-center",
          "split-left",
          "banner-bottom",
          "quote-card",
          "stat-highlight",
        ],
        subjects: [whole],
        judge: async () => verdict(null),
        relayout,
      }),
    ).rejects.toBeInstanceOf(LayoutsHeldError);
  });
});
