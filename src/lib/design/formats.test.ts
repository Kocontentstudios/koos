import { describe, expect, it } from "vitest";
import { DESIGN_FORMATS, formatRules, resolveDesignFormat } from "./formats";
import { DESIGN_TYPE_OPTIONS } from "./tickets-ui";

/* KOOS-AI-001 §1.1. `designType` is free text at every boundary — a form
   select, an LLM's label, or whatever a legacy row holds — and reached the art
   director as one unstructured line. Nothing downstream could branch on it, so
   a YouTube thumbnail and a business card were briefed identically. This maps
   the label onto a format the pipeline can reason about, without making the
   boundary strict and breaking the rows already stored. */
describe("resolveDesignFormat", () => {
  it.each([
    ["Social Media Post", "social-post"],
    ["Carousel", "carousel"],
    ["Flyer", "flyer"],
    ["Poster", "poster"],
    ["Banner", "banner"],
    ["Video Thumbnail", "thumbnail"],
    ["Presentation", "presentation"],
    ["Logo", "logo"],
    ["Brand Identity", "logo"],
    ["Business Card", "print-collateral"],
    ["Packaging", "print-collateral"],
    ["Video Editing", "motion"],
    ["Motion Graphics", "motion"],
    ["UI/UX Design", "product-ui"],
    ["Website Design", "product-ui"],
    ["Custom Request", "other"],
  ])("maps %s to %s", (label, expected) => {
    expect(resolveDesignFormat(label)).toBe(expected);
  });

  /* The chat path invents its own labels and users type freely, so matching is
     by meaning rather than equality. */
  it.each([
    ["instagram carousel (5 slides)", "carousel"],
    ["IG Story", "social-post"],
    ["YouTube thumbnail", "thumbnail"],
    ["A4 flyer for the event", "flyer"],
    ["web banner 1200x300", "banner"],
  ])("reads %s as %s", (label, expected) => {
    expect(resolveDesignFormat(label)).toBe(expected);
  });

  /* An unknown label must not pick a wrong playbook — "other" carries the
     generic rules rather than pretending to recognise it. */
  it.each([null, undefined, "", "   ", "something nobody has thought of"])(
    "falls back to other for %s",
    (label) => {
      expect(resolveDesignFormat(label)).toBe("other");
    },
  );

  it("resolves every option the request form offers", () => {
    for (const option of DESIGN_TYPE_OPTIONS) {
      expect(DESIGN_FORMATS).toContain(resolveDesignFormat(option));
    }
  });
});

describe("formatRules", () => {
  it("gives every format a rule", () => {
    for (const format of DESIGN_FORMATS) {
      expect(formatRules(format).guidance).toBeTruthy();
    }
  });

  /* A thumbnail is read at a fraction of the size of a poster, so the copy
     budget is the thing that most needs to differ per format. */
  it("budgets less headline for a thumbnail than for a poster", () => {
    expect(formatRules("thumbnail").headlineWords).toBeLessThan(
      formatRules("poster").headlineWords,
    );
  });

  it("marks the carousel as multi-page and a flyer as single", () => {
    expect(formatRules("carousel").multiPage).toBe(true);
    expect(formatRules("flyer").multiPage).toBe(false);
  });

  /* Honest about the renderer: the composite path draws one still image, so a
     motion or packaging request cannot be generated today. The pipeline must
     be able to say so rather than silently producing a flat poster. */
  it("knows which formats the renderer cannot produce", () => {
    expect(formatRules("motion").generatable).toBe(false);
    expect(formatRules("print-collateral").generatable).toBe(false);
    expect(formatRules("social-post").generatable).toBe(true);
    expect(formatRules("flyer").generatable).toBe(true);
  });
});
