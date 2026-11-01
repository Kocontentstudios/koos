import { type BriefFact, needsFor } from "@/lib/jobs/directions/brief-facts";
import type { FrameBeat, PlannedSequence } from "./contract";

/**
 * A five-frame cafe carousel that passes every rule, and the brief it was
 * planned from, for the sequence tests. A test breaks one rule on a copy of
 * it, so a failure names that rule and nothing else.
 */

export const CAFE_BRIEF =
  "Launch our cold brew at our Yaba bar. ₦2,500 a bottle. Saturday 15 November, 8am to 2pm. WhatsApp 0803 555 0142 to reserve.";

export function fact(kind: BriefFact["kind"], text: string): BriefFact {
  return { kind, text, needs: needsFor(kind, text) };
}

export const CAFE_FACTS: BriefFact[] = [
  fact("product", "cold brew"),
  fact("price", "₦2,500 a bottle"),
  fact("date", "Saturday 15 November"),
  fact("time", "8am to 2pm"),
  fact("place", "our Yaba bar"),
  fact("contact", "WhatsApp 0803 555 0142"),
];

export function beatOf(over: Partial<FrameBeat> = {}): FrameBeat {
  return {
    role: "body",
    title: "A point",
    headline: "A headline",
    subheadline: "",
    cta: "",
    footerLines: [],
    layout: "hero-center",
    showsImage: false,
    backgroundPrompt: "a warm cream ground",
    ...over,
  };
}

export function cafePlan(over: Partial<PlannedSequence> = {}): PlannedSequence {
  return {
    kind: "carousel",
    palette: {
      background: "#1F2A24",
      foreground: "#F7F1E3",
      accent: "#D9822B",
    },
    logoPlacement: "top-left",
    logoFree: false,
    logoFreeQuote: "",
    backgroundTreatment: "photographic",
    footerStyle: "bar",
    aspectRatio: "4:5",
    frames: [
      beatOf({
        role: "hook",
        title: "Saturday, slowed down",
        headline: "Your Saturday, slowed down",
        subheadline: "Our cold brew, slow-steeped and poured over ice",
        layout: "banner-bottom",
        showsImage: true,
        backgroundPrompt: "a glass bottle of cold brew on a dark wooden bar",
      }),
      beatOf({
        title: "Price per bottle",
        headline: "₦2,500 a bottle",
        layout: "stat-highlight",
      }),
      beatOf({
        title: "15 November",
        headline: "Saturday 15 November",
        subheadline: "8am to 2pm",
        layout: "hero-center",
      }),
      beatOf({
        title: "Our Yaba bar",
        headline: "Pour one at our Yaba bar",
        subheadline: "Sit in with a glass, or carry yours out",
        layout: "split-left",
        showsImage: true,
        backgroundPrompt: "a sunlit bar counter with cold brew glasses",
      }),
      beatOf({
        role: "cta",
        title: "Reserve yours",
        headline: "Reserve a bottle before Saturday",
        cta: "Message us",
        footerLines: ["WhatsApp 0803 555 0142"],
        layout: "quote-card",
      }),
    ],
    ...over,
  };
}

export const CAFE_RULES = {
  frameCount: 5,
  facts: CAFE_FACTS,
  offering: "cold brew",
  hasImage: true,
  brandName: "Kiln Coffee",
};

/** The plan with frame `index` changed, for breaking one rule at a time. */
export function withFrame(
  plan: PlannedSequence,
  index: number,
  over: Partial<FrameBeat>,
): PlannedSequence {
  return {
    ...plan,
    frames: plan.frames.map((beat, i) =>
      i === index ? { ...beat, ...over } : beat,
    ),
  };
}

/* The integration critic's round 2 brief (HIGH 1 and 2): its last
   sentence is a note to the designer, which reached slide 3 as a point and
   then the hook as its headline. */
export const LUMEN_BRIEF =
  "Lumen Coffee is launching Lumen Cold Brew, a 20-hour steeped cold brew, on Saturday 14 November at our Yaba shop (12 Herbert Macaulay Way). A 350ml bottle costs N3,500. Launch day only: buy two, get a free pastry. Brewed with single-origin Ethiopian beans. Order ahead on WhatsApp 0812 555 0199. Audience: young professionals in Yaba and Surulere who want a smooth, low-acid coffee.";
