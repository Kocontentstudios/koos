// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DesignSpec } from "@/lib/design/spec";
import { renderCompositeDesign } from "./composite";

const SPEC: DesignSpec = {
  layout: "hero-center",
  headline: "Lagos Launch Week",
  subheadline: "Free delivery for the first three days",
  cta: "Order now",
  palette: {
    background: "#0F172A",
    foreground: "#FFFFFF",
    accent: "#F97316",
  },
  logoPlacement: "bottom-right",
  backgroundPrompt: "warm city skyline at dusk",
  backgroundTreatment: "photographic",
  nativePrompt: "unused in the composite route",
  aspectRatio: "4:5",
};

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

describe("renderCompositeDesign", () => {
  it("renders a real PNG at the canvas size without a plate or logo", async () => {
    const result = await renderCompositeDesign({
      spec: SPEC,
      brand: { primaryColor: "#0F172A", secondaryColor: "#F97316" },
      plate: null,
      logo: null,
    });

    expect(result.width).toBe(1080);
    expect(result.height).toBe(1350);
    expect(Array.from(result.bytes.slice(0, 4))).toEqual(PNG_MAGIC);
    // A blank canvas compresses to almost nothing; real typography does not.
    expect(result.bytes.byteLength).toBeGreaterThan(5000);
  }, 60_000);

  it("renders every layout without throwing", async () => {
    const layouts: DesignSpec["layout"][] = [
      "hero-center",
      "split-left",
      "banner-bottom",
      "quote-card",
      "stat-highlight",
    ];
    for (const layout of layouts) {
      const result = await renderCompositeDesign({
        spec: { ...SPEC, layout },
        brand: {},
        plate: null,
        logo: null,
      });
      expect(Array.from(result.bytes.slice(0, 4))).toEqual(PNG_MAGIC);
    }
  }, 120_000);

  /* The only ratio rendered here was 4:5 — the one this change did NOT touch.
     Landscape moved from 1200x675 to 1344x756, and nothing else in the suite
     rasterizes at that size, so a regression there would be invisible. */
  it("renders landscape at its changed canvas size", async () => {
    const result = await renderCompositeDesign({
      spec: { ...SPEC, aspectRatio: "16:9" },
      brand: { primaryColor: "#0F172A", secondaryColor: "#F97316" },
      plate: null,
      logo: null,
    });

    expect(result.width).toBe(1344);
    expect(result.height).toBe(756);
    expect(Array.from(result.bytes.subarray(0, 4))).toEqual(PNG_MAGIC);
  }, 30_000);
});
