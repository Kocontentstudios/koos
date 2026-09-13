import type { DesignSpec } from "@/lib/design/spec";

/**
 * Cases for the logo lane. Unlike `eval:design`, which hands literal prompt
 * strings to the adapter, these go through the RENDERER — the composite path
 * that draws the mark itself and the native path that stamps it over the
 * model's output. That is where the logo was being lost.
 */
export interface LogoEvalCase {
  id: string;
  route: "composite" | "native";
  /** "square" or "wordmark" — the two shapes a fixed logo box must place. */
  mark: "square" | "wordmark";
  /** Whether a background plate is generated. Costs one image when true. */
  withPlate: boolean;
  /** False for the logo-free case, where any mark is a failure. */
  expectLogo: boolean;
  spec: Pick<
    DesignSpec,
    "layout" | "headline" | "subheadline" | "cta" | "logoPlacement"
  > &
    Partial<DesignSpec>;
}

const COPY = {
  headline: "Lagos Launch Week",
  subheadline: "Free delivery for the first three days",
  cta: "Order now",
};

const BASE: Partial<DesignSpec> = {
  palette: { background: "#0F172A", foreground: "#FFFFFF", accent: "#F97316" },
  backgroundPrompt: "warm Lagos skyline at dusk, wide open sky",
  backgroundTreatment: "photographic",
  nativePrompt:
    "A bold social media post for a Lagos delivery brand, deep navy ground with a warm orange accent",
  aspectRatio: "4:5",
};

export const LOGO_EVAL_CASES: LogoEvalCase[] = [
  {
    /* The flat composite: no model spend, and the case that proves the mark
       survives the renderer at all. */
    id: "composite-square-flat",
    route: "composite",
    mark: "square",
    withPlate: false,
    expectLogo: true,
    spec: {
      ...BASE,
      ...COPY,
      layout: "hero-center",
      logoPlacement: "top-right",
    },
  },
  {
    /* A wordmark in the card layout — the two conditions that used to put the
       mark on top of the centred copy. */
    id: "composite-wordmark-card",
    route: "composite",
    mark: "wordmark",
    withPlate: false,
    expectLogo: true,
    spec: {
      ...BASE,
      ...COPY,
      layout: "quote-card",
      logoPlacement: "bottom-right",
    },
  },
  {
    /* Over photography, where contrast against the plate is the risk. */
    id: "composite-square-plate",
    route: "composite",
    mark: "square",
    withPlate: true,
    expectLogo: true,
    spec: {
      ...BASE,
      ...COPY,
      layout: "banner-bottom",
      logoPlacement: "top-right",
    },
  },
  {
    /* The native route: the model composes, we stamp. Doubling is the failure
       to watch for here — a model that drew its own logo too. */
    id: "native-wordmark",
    route: "native",
    mark: "wordmark",
    withPlate: false,
    expectLogo: true,
    spec: {
      ...BASE,
      ...COPY,
      layout: "hero-center",
      logoPlacement: "top-left",
    },
  },
  {
    /* A brief that asked for no logo must come back with none — otherwise the
       fix has simply traded one wrong behaviour for another. */
    id: "composite-logo-free",
    route: "composite",
    mark: "square",
    withPlate: false,
    expectLogo: false,
    spec: { ...BASE, ...COPY, layout: "hero-center", logoPlacement: "none" },
  },
];
