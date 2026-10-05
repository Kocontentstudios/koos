import { describe, expect, it } from "vitest";
import { designSpecSchema } from "./spec";

/* KOOS-AI-001. `bodyPoints` existed in the schema and nowhere else — no
   layout drew it, no prompt mentioned it. The art director filled it because
   the schema offered it, and the benchmark caught where that leads: a brief
   that asked for the event date produced
   ["[EVENT DATE] · [EVENT TIME]", "[VENUE NAME], Lagos"] in bodyPoints, and
   the renderer discarded every word. A field that silently eats the user's
   information is worse than no field. */
describe("the design spec offers no field the renderer cannot draw", () => {
  it("has no bodyPoints", () => {
    const parsed = designSpecSchema.parse({
      layout: "hero-center",
      headline: "Weekend pies",
      palette: {
        background: "#111111",
        foreground: "#ffffff",
        accent: "#00ff00",
      },
      logoPlacement: "top-right",
      logoFree: false,
      logoFreeQuote: "",
      backgroundPrompt: "a warm kitchen",
      backgroundTreatment: "photographic",
      nativePrompt: "a warm kitchen with the headline",
      aspectRatio: "1:1",
      bodyPoints: ["this should not survive"],
    });

    expect(parsed).not.toHaveProperty("bodyPoints");
  });
});

/* KOOS-AI-001 phase 2: the spec can now carry utility information, because
   the renderer can finally draw it. Required rather than optional, with empty
   values as the "no footer" signal: Bedrock compiles the schema into a
   decoding grammar and every optional property is a union it has to consider
   (see the 16-union ceiling that broke onboarding extraction). */
describe("the design spec carries a footer", () => {
  const base = {
    layout: "hero-center",
    headline: "Weekend pies",
    palette: {
      background: "#111111",
      foreground: "#ffffff",
      accent: "#00ff00",
    },
    logoPlacement: "top-right",
    logoFree: false,
    logoFreeQuote: "",
    backgroundPrompt: "a warm kitchen",
    backgroundTreatment: "photographic",
    nativePrompt: "a warm kitchen with the headline",
    aspectRatio: "1:1",
  };

  it("accepts a footer with lines", () => {
    const parsed = designSpecSchema.parse({
      ...base,
      footerStyle: "bar",
      footerLines: ["Call [PHONE NUMBER]", "Delivery across Yaba"],
    });

    expect(parsed.footerLines).toHaveLength(2);
    expect(parsed.footerStyle).toBe("bar");
  });

  it("accepts an explicit no-footer", () => {
    const parsed = designSpecSchema.parse({
      ...base,
      footerStyle: "none",
      footerLines: [],
    });

    expect(parsed.footerStyle).toBe("none");
  });

  /* A model that omits the fields entirely must not fail the whole design —
     the same reason every other addition here defaults rather than throws. */
  it("defaults to no footer when the model omits it", () => {
    const parsed = designSpecSchema.parse(base);

    expect(parsed.footerStyle).toBe("none");
    expect(parsed.footerLines).toEqual([]);
  });
});
