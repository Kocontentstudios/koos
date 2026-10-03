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
