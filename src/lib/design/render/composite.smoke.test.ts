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
});
