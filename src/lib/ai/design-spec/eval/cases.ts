import type { BrandSummary } from "@/lib/ai/prompts/strategy";

export interface DesignSpecEvalCase {
  id: string;
  brand: BrandSummary;
  /** Design-request lines, mirroring buildDesignSpecPrompt's input. */
  request: {
    title: string;
    designType: string;
    dimensions: string;
    platform: string;
    aspectRatio: string;
    briefText: string;
  };
  /** Hex colours the palette should draw on. Empty when the brand states none. */
  brandHexes: string[];
  /** Set when the brand states a colour by name rather than as a hex. */
  expectedHue?: "red" | "green" | "blue";
}

const baseRequest = {
  title: "Autumn collection launch",
  designType: "Instagram Post",
  dimensions: "1080x1350",
  platform: "Instagram",
  aspectRatio: "4:5",
  briefText:
    "Announce the autumn collection. One strong headline, a short supporting line, and a clear call to action.",
};

export const DESIGN_SPEC_EVAL_CASES: DesignSpecEvalCase[] = [
  {
    id: "full-palette",
    brand: {
      name: "Lagos Loom",
      overview: "Handwoven aso-oke textiles for modern homes.",
      tone: "Warm and confident",
      primaryColor: "#0F172A",
      secondaryColor: "#F97316",
      additionalColors: ["#22C55E", "#EAB308"],
    },
    request: baseRequest,
    brandHexes: ["#0F172A", "#F97316", "#22C55E", "#EAB308"],
  },
  {
    /* The regression this lane exists for: before brandPalette() the art
       director was told to use "the brand's colours" and never given them. */
    id: "two-colours-only",
    brand: {
      name: "Okra Kitchen",
      overview: "Small-batch pepper sauces made in Ibadan.",
      tone: "Playful and bold",
      primaryColor: "#7C2D12",
      secondaryColor: "#FEF3C7",
      additionalColors: null,
    },
    request: baseRequest,
    brandHexes: ["#7C2D12", "#FEF3C7"],
  },
  {
    /* The conversational path stores colour names, so the prompt asks the
       model to convert one. Scored by hue, not by an exact hex. */
    id: "named-colour",
    brand: {
      name: "Fern & Field",
      overview: "Refillable plant care for apartment growers.",
      tone: "Calm and trustworthy",
      primaryColor: "forest green",
      secondaryColor: null,
      additionalColors: null,
    },
    request: baseRequest,
    brandHexes: [],
    expectedHue: "green",
  },
  {
    /* No colours stated: the prompt tells the model to pick a palette that
       fits the visual style. It must still return usable, readable hexes. */
    id: "no-colours",
    brand: {
      name: "Northwind Studio",
      overview: "Brand identity work for early-stage founders.",
      brandStyle: "Minimal and monochrome",
      primaryColor: null,
      secondaryColor: null,
      additionalColors: null,
    },
    request: baseRequest,
    brandHexes: [],
  },
];

export const DESIGN_SPEC_EVAL_THRESHOLDS = {
  /** Every slot must be a real hex — resolvePalette can rescue one, not three. */
  minValidHex: 1,
  /** Across cases that state hexes, how often the palette actually uses one. */
  minBrandColorUse: 0.8,
  /** Foreground must read against background before resolvePalette intervenes. */
  minContrastOk: 0.75,
};
