import { describe, expect, it } from "vitest";
import { designSpecSchema } from "@/lib/design/spec";
import { cafePlan, withFrame } from "./fixtures";
import { footerStyleFor, frameSpec } from "./frame-spec";

describe("frameSpec", () => {
  const plan = cafePlan();
  const specs = plan.frames.map((_, i) => frameSpec(plan, i));

  it("is an ordinary single-frame spec the renderer accepts", () => {
    for (const spec of specs) {
      expect(designSpecSchema.safeParse(spec).success).toBe(true);
    }
  });

  it("gives every frame the set's palette, logo, treatment and aspect", () => {
    for (const spec of specs) {
      expect(spec.palette).toEqual(plan.palette);
      expect(spec.logoPlacement).toBe("top-left");
      expect(spec.logoFree).toBe(false);
      expect(spec.backgroundTreatment).toBe("photographic");
      expect(spec.aspectRatio).toBe("4:5");
    }
  });

  it("does not let a frame's palette share the plan's object", () => {
    specs[0].palette.background = "#000000";
    expect(plan.palette.background).toBe("#1F2A24");
  });

  it("carries the button on the call-to-action frame only", () => {
    expect(specs.map((s) => s.cta)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      "Message us",
    ]);
    const stray = withFrame(plan, 1, { cta: "Buy now" });
    expect(frameSpec(stray, 1).cta).toBeUndefined();
  });

  it("draws the frame's words as written", () => {
    expect(specs[2]).toMatchObject({
      headline: "Saturday 15 November",
      subheadline: "8am to 2pm",
      layout: "hero-center",
    });
    expect(specs[1].subheadline).toBeUndefined();
  });

  it("draws the set's footer system only where a frame has lines", () => {
    expect(specs.map((s) => s.footerStyle)).toEqual([
      "none",
      "none",
      "none",
      "none",
      "bar",
    ]);
    expect(specs[4].footerLines).toEqual(["WhatsApp 0803 555 0142"]);
  });

  it("builds the native prompt from the beat", () => {
    expect(specs[0].nativePrompt).toContain("Frame 1 of 5 of a carousel");
    expect(specs[0].nativePrompt).toContain("earn the swipe");
    expect(specs[4].nativePrompt).toContain("carries the action");
    expect(specs[1].nativePrompt).toContain("Text-led");
    const deck = cafePlan({ kind: "presentation", aspectRatio: "16:9" });
    expect(frameSpec(deck, 2).nativePrompt).toContain("Slide 3 of 5");
  });

  it("falls back to a neutral ground, never copy, for an empty scene", () => {
    const blank = withFrame(plan, 1, { backgroundPrompt: "  " });
    const ground = frameSpec(blank, 1).backgroundPrompt;
    expect(ground).toContain("#1F2A24");
    expect(ground).not.toContain(plan.frames[1].headline);
    expect(designSpecSchema.safeParse(frameSpec(blank, 1)).success).toBe(true);
  });

  it("refuses an index outside the set", () => {
    expect(() => frameSpec(plan, 5)).toThrow(RangeError);
  });
});

describe("footerStyleFor", () => {
  it("draws lines under a plan that chose no footer as text", () => {
    expect(footerStyleFor({ footerStyle: "none" }, ["Call 0803"])).toBe("text");
    expect(footerStyleFor({ footerStyle: "bar" }, [])).toBe("none");
    expect(footerStyleFor({ footerStyle: "bar" }, ["Call 0803"])).toBe("bar");
  });
});
