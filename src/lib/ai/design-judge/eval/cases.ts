import type { BrandSummary } from "@/lib/ai/prompts/strategy";
import type { DesignFault } from "@/lib/design/quality/checks";
import type {
  DesignRenderer,
  DiagnosticSymptom,
} from "@/lib/design/quality/judge";
import { type DesignSpec, designSpecSchema } from "@/lib/design/spec";

/**
 * Cases for `eval:design-judge` — one failed design each.
 *
 * Every case is a design that has already failed `checkRenderedDesign`, which
 * is the only state the judge is ever reached from. The fault codes are
 * therefore limited to the three in `CORRECTABLE` (quality/gate.ts):
 * `wrong-dimensions` never reaches the judge, so a case built on it would
 * measure a path production does not have.
 *
 * The spec of each case is written to present one of §11's nine symptoms, so
 * the lane covers the correction map rather than one easy failure nine times.
 * Which symptom the judge then names is its own read and is recorded, not
 * asserted: what IS asserted is whether the field it prescribed is one §11
 * treats that symptom with, which has a single correct answer given the
 * output.
 */

/** How the case's rendered bytes are produced. */
export type JudgeEvalImage =
  /** A real composite render — a readable design the judge can look at. */
  | "render"
  /** A flat frame. Readable bytes with nothing in them, which is why
   *  `visualEvidence` withholds it: the blank-frame check already said so in
   *  words and a vision payload of an empty rectangle is spend for nothing. */
  | "flat"
  /** No bytes at all, as on the `unreadable-image` path. */
  | "none";

export interface DesignJudgeEvalCase {
  id: string;
  /** Why the case exists, carried into the report so a row reads on its own. */
  what: string;
  renderer: DesignRenderer;
  spec: DesignSpec;
  faults: DesignFault[];
  brand: BrandSummary;
  hasLogo: boolean;
  brief: string;
  image: JudgeEvalImage;
  /** The symptom the design was built to present. Recorded for the report;
   *  never scored against, because the judge's read of a design is the latent
   *  half of this call and a fixed expectation would be grading the model
   *  against the case author's taste. */
  presents: DiagnosticSymptom;
}

const LOOM: BrandSummary = {
  name: "Lagos Loom",
  overview: "Handwoven aso-oke textiles for modern homes.",
  tone: "Warm, confident, unhurried",
  targetAudience: "Lagos homeowners furnishing a first flat",
  offer: "Made-to-order throws, cushions and runners",
  primaryColor: "#0F172A",
  secondaryColor: "#F97316",
  additionalColors: ["#FDE68A"],
};

const CLINIC: BrandSummary = {
  name: "Ìtura Dental",
  overview: "A calm family dental practice in Surulere.",
  tone: "Reassuring and plain-spoken",
  targetAudience: "Parents booking a first visit for their children",
  offer: "Check-ups, cleaning and childrens' dentistry",
  primaryColor: "#0E7490",
  secondaryColor: "#FFFFFF",
  additionalColors: null,
};

const PALETTE = {
  background: "#0F172A",
  foreground: "#FFFFFF",
  accent: "#F97316",
};

/** Keeps every fixture a spec the real renderer would accept. A case the
 *  schema refuses measures the case, not the judge. */
function spec(partial: Record<string, unknown>): DesignSpec {
  return designSpecSchema.parse({
    layout: "hero-center",
    palette: PALETTE,
    logoPlacement: "top-right",
    logoFree: false,
    logoFreeQuote: "",
    backgroundTreatment: "photographic",
    /* Required by the schema on both routes even though only the native one
       reads it, so a composite case that leaves it out is a parse error rather
       than a design. */
    nativePrompt: "A warm poster for a Lagos textile brand",
    aspectRatio: "1:1",
    ...partial,
  });
}

const UNREADABLE_LOGO: DesignFault = {
  code: "unreadable-logo",
  detail:
    "The brand mark does not read against what sits behind it, measured from the rendered pixels.",
};

const BLANK_FRAME: DesignFault = {
  code: "blank-frame",
  detail:
    "The frame is flat — 0.0031 bytes per pixel, below the 0.05 floor a real design clears. The background came back empty.",
};

const UNREADABLE_IMAGE: DesignFault = {
  code: "unreadable-image",
  detail: "The render returned no image bytes at all.",
};

export const DESIGN_JUDGE_EVAL_CASES: DesignJudgeEvalCase[] = [
  {
    id: "crowded-composite",
    what: "Every copy slot full and a three-line footer on one square frame",
    renderer: "composite",
    presents: "crowded",
    image: "render",
    hasLogo: true,
    brand: LOOM,
    faults: [UNREADABLE_LOGO],
    brief:
      "Announce the new aso-oke throw range. The collection is made to order and ships in ten days. Mention the Yaba showroom.",
    spec: spec({
      headline: "The new aso-oke throw range is made to order in Lagos",
      subheadline:
        "Ten colourways, handwoven to your measurements, finished by hand and delivered across Lagos in ten days",
      cta: "Order a throw today",
      footerStyle: "text",
      footerLines: [
        "12b Herbert Macaulay Way, Yaba",
        "0800 111 2222 — open Mon to Sat",
        "lagosloom.ng/throws",
      ],
      backgroundPrompt:
        "a stack of folded handwoven throws on a wooden bench, warm window light, shallow depth of field",
    }),
  },
  {
    id: "empty-composite",
    what: "One short line on an empty plate — the blank-frame path, spec-only",
    renderer: "composite",
    presents: "empty",
    image: "flat",
    hasLogo: true,
    brand: LOOM,
    faults: [BLANK_FRAME],
    brief:
      "A simple holding post for the showroom reopening. Keep it to a single idea.",
    spec: spec({
      headline: "We are open",
      footerStyle: "none",
      footerLines: [],
      backgroundTreatment: "gradient",
      backgroundPrompt: "a soft neutral gradient",
    }),
  },
  {
    id: "flat-composite",
    what: "No depth anywhere: a gradient plate and copy sitting flat on it",
    renderer: "composite",
    presents: "flat",
    image: "render",
    hasLogo: true,
    brand: LOOM,
    faults: [UNREADABLE_LOGO],
    brief:
      "Promote the cushion range. The product should feel tactile — these are things people touch.",
    spec: spec({
      headline: "Cushions you want to touch",
      subheadline: "Handwoven in Lagos",
      cta: "See the range",
      footerStyle: "none",
      footerLines: [],
      backgroundTreatment: "gradient",
      backgroundPrompt: "an even two-colour gradient, no imagery, no depth",
    }),
  },
  {
    id: "generic-composite",
    what: "A stock-photo instruction that could belong to any brand at all",
    renderer: "composite",
    presents: "generic",
    image: "render",
    hasLogo: true,
    brand: LOOM,
    faults: [UNREADABLE_LOGO],
    brief:
      "Introduce the brand to people who have never heard of it. The weaving is the whole story — it is done by hand in Lagos.",
    spec: spec({
      headline: "Quality you can trust",
      subheadline: "Great products for great people",
      cta: "Shop now",
      footerStyle: "none",
      footerLines: [],
      backgroundPrompt:
        "a bright modern interior with a sofa, generic stock photography look",
    }),
  },
  {
    id: "off-brand-composite",
    what: "A palette and a voice from somewhere else entirely",
    renderer: "composite",
    presents: "off-brand",
    image: "render",
    hasLogo: true,
    brand: CLINIC,
    faults: [UNREADABLE_LOGO],
    brief:
      "Invite parents to book a first check-up for their children. The practice is calm and unhurried; nothing about this should feel like a sale.",
    spec: designSpecSchema.parse({
      layout: "stat-highlight",
      headline: "BOOK NOW AND SAVE BIG",
      subheadline: "Limited slots this week only",
      cta: "Claim offer",
      footerStyle: "bar",
      footerLines: ["0803 444 5555", "Surulere, Lagos"],
      palette: {
        background: "#7F1D1D",
        foreground: "#FFFFFF",
        accent: "#A3E635",
      },
      logoPlacement: "top-right",
      logoFree: false,
      logoFreeQuote: "",
      backgroundPrompt:
        "a bright red promotional burst, high energy, flash sale feel",
      backgroundTreatment: "illustration",
      nativePrompt: "A loud discount poster for a dental clinic",
      aspectRatio: "1:1",
    }),
  },
  {
    id: "repetitive-composite",
    what: "The brand's default frame again: same layout, same scene, same crop",
    renderer: "composite",
    presents: "repetitive",
    image: "render",
    hasLogo: true,
    brand: LOOM,
    faults: [UNREADABLE_LOGO],
    brief:
      "Fourth post in the rooftop series. The last three were all centred copy over the same rooftop shot — this one needs to look different while staying on brand.",
    spec: spec({
      headline: "Rooftop evenings, woven in",
      subheadline: "The same warmth, every evening",
      cta: "See the range",
      footerStyle: "none",
      footerLines: [],
      backgroundPrompt:
        "a warm Lagos rooftop at dusk, wide open sky, centred composition",
    }),
  },
  {
    id: "pasted-footer-composite",
    what: "A footer band with nothing tying it to the composition above it",
    renderer: "composite",
    presents: "pasted-footer",
    image: "render",
    hasLogo: true,
    brand: CLINIC,
    faults: [UNREADABLE_LOGO],
    brief:
      "Saturday opening hours. Parents need the phone number and the address to be the easiest thing to read on it.",
    spec: designSpecSchema.parse({
      layout: "banner-bottom",
      headline: "Saturdays are for check-ups",
      subheadline: "Open nine until two",
      cta: "Call to book",
      footerStyle: "bar",
      footerLines: ["0803 444 5555 | 14 Adeniran Ogunsanya St | Surulere"],
      palette: {
        background: "#0E7490",
        foreground: "#FFFFFF",
        accent: "#FDE68A",
      },
      logoPlacement: "top-right",
      logoFree: false,
      logoFreeQuote: "",
      backgroundPrompt:
        "a calm waiting room with soft daylight, plants on a low table",
      backgroundTreatment: "photographic",
      nativePrompt: "A calm Saturday opening-hours poster for a dental clinic",
      aspectRatio: "4:5",
    }),
  },
  {
    id: "weak-cta-native",
    what: "The native route, with the action buried in the supporting line",
    renderer: "native",
    presents: "weak-cta",
    image: "render",
    hasLogo: true,
    brand: LOOM,
    faults: [UNREADABLE_LOGO],
    brief:
      "Drive orders for the made-to-order runners. The action is the point of the post.",
    spec: spec({
      headline: "Runners, woven to your table",
      subheadline:
        "Choose a colourway, send us the length, and order through the website whenever you are ready",
      cta: "More",
      footerStyle: "none",
      footerLines: [],
      nativePrompt:
        "A warm poster of a handwoven table runner on a dining table at dusk, copy centred",
      backgroundPrompt:
        "a handwoven table runner on a dining table at dusk, warm light",
    }),
  },
  {
    id: "artificial-native",
    what: "The native route with no mark and no bytes — spec-only, no logo lever",
    renderer: "native",
    presents: "artificial",
    image: "none",
    hasLogo: false,
    brand: LOOM,
    faults: [UNREADABLE_IMAGE],
    brief:
      "A product post for the cushion range. It has to look like a photograph of a real room, not a render.",
    spec: spec({
      headline: "Woven for real rooms",
      subheadline: "Cushions made to order in Lagos",
      cta: "See the range",
      footerStyle: "none",
      footerLines: [],
      nativePrompt:
        "A floating cushion on a pure white void, perfectly even lighting, no shadow, product render look",
      backgroundPrompt: "a cushion on a bench in a sunlit room",
    }),
  },
];

/**
 * The bar, set before the lane was first run.
 *
 * `minAcceptanceRate` is the headline. It is the number that separates "the
 * system corrects weak outputs" from "the system pays for a verdict and then
 * declines it": a judge whose prescriptions the guards refuse most of the time
 * is spending a reasoning call per failed variant to deliver the design the
 * user already had. Two thirds is the floor at which the pass is worth its
 * price; the undrawn-field and unchanged-spec counts are hard zeroes because
 * each one is a defect this module was written to make unreachable.
 */
export const DESIGN_JUDGE_EVAL_THRESHOLDS = {
  /** Every call must come back with ten scores, a symptom and a prescription. */
  minVerdictRate: 1,
  minAcceptanceRate: 0.67,
  /** §11's map is enforced in code, so an off-map prescription is a prompt
   *  failure that costs the whole correction pass. */
  minSymptomTreatsField: 0.8,
  /** The verdict the caller receives must satisfy §10's 1-5 scale. */
  minScoresInRange: 1,
  /** The judge must see the render exactly when there is something to see. */
  minSawImageAsExpected: 1,
};

export type DesignJudgeEvalThresholds = typeof DESIGN_JUDGE_EVAL_THRESHOLDS;
