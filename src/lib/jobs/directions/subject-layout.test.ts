import { describe, expect, it, vi } from "vitest";
import {
  SUBJECT_COVERED,
  SUBJECT_CROPPED,
  type SubjectBox,
} from "@/lib/design/document/subject";
import type { DesignSpec } from "@/lib/design/spec";
import {
  HEADLINE_NOT_LEADING,
  HEADLINE_UNDER_COPY,
  IMAGE_AGAINST_EDGE,
} from "./craft";
import { draftOf } from "./fixtures";
import { designSpecOf } from "./schema";
import {
  chooseLayout,
  isCleanAlternative,
  LAYOUT_CRAFT_FAILED,
  LayoutsHeldError,
  type LayoutVerdict,
  SAME_SHAPE_AS_SIBLING,
  SUBJECT_FACE_ONLY,
  SUBJECT_UNKNOWN,
  TEXT_LED_LAYOUTS,
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
      subjects: [],
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
      subjects: [],
      judge,
      relayout,
    });
    expect(clean.spec.layout).toBe("stat-highlight");
    const soft = await chooseLayout({
      spec,
      held: ["stat-highlight"],
      subjects: [],
      judge,
      relayout,
    });
    expect(soft.fault).toBe(HEADLINE_NOT_LEADING);
  });

  /* Round-6 eval, run b: textile-launch-ko's quote-card shipped its photo
     flush against the card edge because every inset cropped it, while
     other layouts had only a softer fault. */
  describe("a photo against the card edge", () => {
    it("is passed over for a layout with a softer fault", async () => {
      const judge = vi.fn(async (s: DesignSpec) =>
        verdict(null, {
          soft:
            s.layout === "quote-card"
              ? IMAGE_AGAINST_EDGE
              : HEADLINE_NOT_LEADING,
        }),
      );
      const choice = await chooseLayout({
        spec: { ...spec, layout: "quote-card" },
        held: [],
        subjects: [whole],
        judge,
        relayout,
      });
      expect(choice.spec.layout).not.toBe("quote-card");
      expect(choice.fault).toBe(HEADLINE_NOT_LEADING);
    });

    it("is passed over for a clean layout", async () => {
      const judge = vi.fn(async (s: DesignSpec) =>
        verdict(null, {
          soft: s.layout === "quote-card" ? IMAGE_AGAINST_EDGE : null,
        }),
      );
      const choice = await chooseLayout({
        spec: { ...spec, layout: "quote-card" },
        held: [],
        subjects: [whole],
        judge,
        relayout,
      });
      expect(choice.spec.layout).not.toBe("quote-card");
      expect(choice.fault).toBeNull();
      expect(
        choice.considered.filter(isCleanAlternative).map((c) => c.layout),
      ).toEqual([choice.spec.layout]);
    });

    it("is delivered, with its fault, only when every other layout crops or covers", async () => {
      const judge = vi.fn(async (s: DesignSpec) =>
        s.layout === "quote-card"
          ? verdict(null, { soft: IMAGE_AGAINST_EDGE })
          : verdict(SUBJECT_CROPPED),
      );
      const choice = await chooseLayout({
        spec: { ...spec, layout: "hero-center" },
        held: [],
        subjects: [whole],
        judge,
        relayout,
      });
      expect(choice.spec.layout).toBe("quote-card");
      expect(choice.faults).toContain(IMAGE_AGAINST_EDGE);
      expect(choice.considered.filter(isCleanAlternative)).toEqual([]);
      expect(choice.considered.map((c) => c.layout)).toContain("split-left");
    });
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

  /* Round-4 code critic J7: with the subject box refused and a face found,
     the face was taken for the whole subject and copy covered the tray of
     croissants with nothing recorded. */
  it("treats a face alone as an unknown subject, and says so", async () => {
    const judge = vi.fn(async () => verdict(null));
    const choice = await chooseLayout({
      spec,
      held: [],
      subjects: [null, face],
      judge,
      relayout,
    });
    expect(choice.wholeSubject).toBeNull();
    expect(choice.subject).toEqual(face);
    expect(choice.fault).toBe(SUBJECT_UNKNOWN);
    expect(choice.faults).toEqual([SUBJECT_UNKNOWN]);
    expect(choice.faults).not.toContain(SUBJECT_FACE_ONLY);
  });

  /* J8: the upload's look was unavailable and nothing recorded it. */
  it("records an unknown subject when the look at the photo failed", async () => {
    const choice = await chooseLayout({
      spec,
      held: [],
      subjects: [null, null],
      judge: async () => verdict(null),
      relayout,
    });
    expect(choice.subject).toBeNull();
    expect(choice.fault).toBe(SUBJECT_UNKNOWN);
  });

  /* Round-4 live critic: a KO direction whose plate failed twice shipped
     split-left with half the canvas an empty gradient. */
  it("lays an imageless direction out as text, never with an empty image half", async () => {
    const judge = vi.fn(async (_s: DesignSpec, _box: SubjectBox | null) =>
      verdict(null),
    );
    const choice = await chooseLayout({
      spec: { ...spec, layout: "split-left" },
      held: [],
      subjects: [],
      imageless: true,
      judge,
      relayout,
    });
    expect(TEXT_LED_LAYOUTS).toContain(choice.spec.layout);
    for (const [tried] of judge.mock.calls) {
      expect(TEXT_LED_LAYOUTS).toContain(tried.layout);
    }
    expect(choice.fault).toBeNull();
  });

  it("refuses an imageless direction when every text-led layout is held", async () => {
    await expect(
      chooseLayout({
        spec,
        held: [...TEXT_LED_LAYOUTS],
        subjects: [],
        imageless: true,
        judge: async () => verdict(null),
        relayout,
      }),
    ).rejects.toBeInstanceOf(LayoutsHeldError);
  });

  /* Round-4 live critic: on one photo both directions put it on top with
     the copy below, so the pair read as one design. */
  const above = {
    box: { x: 0.08, y: 0.06, w: 0.34, h: 0.42 },
    arrangement: "above" as const,
  };
  it("keeps the photo apart from where the sibling put it", async () => {
    const beside = {
      box: { x: 0.52, y: 0, w: 0.48, h: 1 },
      arrangement: "beside" as const,
    };
    const judge = vi.fn(async (s: DesignSpec) => ({
      ...verdict(null),
      /* A different frame, but still above the copy: the same shape. */
      place:
        s.layout === "split-left"
          ? beside
          : {
              box: { x: 0.34, y: 0.03, w: 0.32, h: 0.42 },
              arrangement: "above" as const,
            },
    }));
    const choice = await chooseLayout({
      spec,
      held: [],
      subjects: [whole],
      judge,
      relayout,
      apartFrom: above,
    });
    expect(choice.spec.layout).toBe("split-left");
    expect(choice.fault).toBeNull();
    expect(choice.place).toEqual(beside);
  });

  it("takes the same shape only when nothing else is clean, and says so", async () => {
    const choice = await chooseLayout({
      spec,
      held: [],
      subjects: [whole],
      judge: async () => ({ ...verdict(null), place: above }),
      relayout,
      apartFrom: above,
    });
    expect(choice.fault).toBe(SAME_SHAPE_AS_SIBLING);
  });
});

/* Round 21, round-8 live critic finding 5: the event pair shipped in
   stat-highlight and quote-card, one card template in two colourways. */
describe("a text-led pair keeps its compositions apart", () => {
  const clean = async (): Promise<LayoutVerdict> => ({
    subjectFault: null,
    craft: { hard: null, soft: null },
    place: null,
  });

  it("a second text-led direction beside a card takes another composition", async () => {
    const choice = await chooseLayout({
      spec: { ...spec, layout: "quote-card" },
      held: ["stat-highlight"],
      subjects: [],
      imageless: true,
      apartLayout: "stat-highlight",
      judge: clean,
      relayout,
    });
    expect(choice.spec.layout).toBe("hero-center");
    expect(choice.faults).toEqual([]);
  });

  it("takes the shared composition, recorded, only when nothing else is free", async () => {
    const { SAME_COMPOSITION_AS_SIBLING } = await import("./subject-layout");
    const choice = await chooseLayout({
      spec: { ...spec, layout: "quote-card" },
      held: ["stat-highlight", "hero-center"],
      subjects: [],
      imageless: true,
      apartLayout: "stat-highlight",
      judge: clean,
      relayout,
    });
    expect(choice.spec.layout).toBe("quote-card");
    expect(choice.faults).toContain(SAME_COMPOSITION_AS_SIBLING);
  });
});

/* Round-9 live critic: the cafe pair was one card twice (quote-card and
   stat-highlight, the photo in the same place), recorded as "the same
   photo in the same place" and shipped; fashion and storefront were
   left/right mirrors of one split. */
describe("round 22: an upload pair keeps its compositions apart", () => {
  const above = {
    box: { x: 0.1, y: 0.05, w: 0.8, h: 0.4 },
    arrangement: "above" as const,
  };
  const placeOf: Record<string, LayoutVerdict["place"]> = {
    "stat-highlight": above,
    "hero-center": above,
    "banner-bottom": {
      box: { x: 0, y: 0, w: 1, h: 0.55 },
      arrangement: "above",
    },
    "split-left": {
      box: { x: 0.5, y: 0, w: 0.5, h: 1 },
      arrangement: "beside",
    },
  };

  it("cafe: a card beside a card is refused for a layout that shows the photo elsewhere, even one with a soft fault", async () => {
    const judge = async (s: DesignSpec): Promise<LayoutVerdict> => ({
      subjectFault: null,
      craft: {
        hard: null,
        soft: s.layout === "split-left" ? HEADLINE_NOT_LEADING : null,
      },
      place: placeOf[s.layout],
    });
    const choice = await chooseLayout({
      spec: { ...spec, layout: "stat-highlight" },
      held: ["quote-card"],
      subjects: [whole],
      apartFrom: above,
      apartLayout: "quote-card",
      judge,
      relayout,
    });
    expect(choice.spec.layout).toBe("split-left");
    expect(choice.faults).not.toContain(SAME_SHAPE_AS_SIBLING);
    expect(
      choice.considered.find((c) => c.layout === "stat-highlight")?.alike,
    ).toBe(true);
  });

  it("a second card is alike by composition even with its photo elsewhere", async () => {
    const { SAME_COMPOSITION_AS_SIBLING } = await import("./subject-layout");
    const elsewhere = {
      box: { x: 0, y: 0.6, w: 1, h: 0.4 },
      arrangement: "below" as const,
    };
    const judge = async (s: DesignSpec): Promise<LayoutVerdict> => ({
      subjectFault: s.layout === "stat-highlight" ? null : SUBJECT_COVERED,
      craft: { hard: null, soft: null },
      place: elsewhere,
    });
    const choice = await chooseLayout({
      spec: { ...spec, layout: "stat-highlight" },
      held: ["quote-card"],
      subjects: [whole],
      apartFrom: above,
      apartLayout: "quote-card",
      judge,
      relayout,
    });
    expect(choice.spec.layout).toBe("stat-highlight");
    expect(choice.faults).toContain(SAME_COMPOSITION_AS_SIBLING);
  });

  it("fashion: a split mirrored on the other side is the same composition, taken only when nothing else shows the photo whole", async () => {
    const mirrored = {
      box: { x: 0, y: 0, w: 0.5, h: 1 },
      arrangement: "beside" as const,
    };
    const judge = async (s: DesignSpec): Promise<LayoutVerdict> => ({
      subjectFault:
        s.layout === "hero-center" || s.layout === "banner-bottom"
          ? null
          : SUBJECT_COVERED,
      craft: {
        hard: null,
        soft: s.layout === "banner-bottom" ? IMAGE_AGAINST_EDGE : null,
      },
      place: s.layout === "hero-center" ? mirrored : placeOf[s.layout],
    });
    const apart = {
      apartFrom: placeOf["split-left"],
      apartLayout: "split-left",
    };
    const choice = await chooseLayout({
      spec: { ...spec, layout: "hero-center" },
      held: ["split-left"],
      subjects: [whole],
      ...apart,
      judge,
      relayout,
    });
    expect(choice.spec.layout).toBe("banner-bottom");
    const onlyMirror = await chooseLayout({
      spec: { ...spec, layout: "hero-center" },
      held: ["split-left", "banner-bottom"],
      subjects: [whole],
      ...apart,
      judge,
      relayout,
    });
    expect(onlyMirror.spec.layout).toBe("hero-center");
    expect(onlyMirror.faults).toContain(SAME_SHAPE_AS_SIBLING);
  });
});
