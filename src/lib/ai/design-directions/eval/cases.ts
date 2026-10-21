import type { DesignCategory } from "@/lib/ai/design-training/playbooks";
import type { BrandSummary } from "@/lib/ai/prompts/strategy";

/**
 * Brand and brief fixtures for the directions eval. Varied on purpose: six
 * playbook categories, both image sources, briefs with hard facts (prices,
 * dates, a speaker) and one with none (a greeting), so "different concepts"
 * is tested where it is easy and where it is hard.
 */

export interface DirectionsEvalCase {
  id: string;
  brand: BrandSummary;
  hasLogo: boolean;
  imageSource: "upload" | "ko";
  category: DesignCategory;
  request: {
    title: string;
    designType: string;
    dimensions: string;
    platform: string;
    aspectRatio: "1:1" | "4:5" | "9:16" | "16:9";
    briefText: string;
  };
}

export const DIRECTIONS_EVAL_CASES: DirectionsEvalCase[] = [
  {
    id: "bakery-upload",
    brand: {
      name: "Crumb & Co.",
      overview: "Neighbourhood bakery in Lekki, Lagos, baking French pastry.",
      targetAudience: "Commuters and weekend brunch regulars",
      tone: "Warm, unfussy, a little playful",
      primaryColor: "#FFF4E6",
      secondaryColor: "#C2410C",
      additionalColors: ["#3B2416"],
    },
    hasLogo: true,
    imageSource: "upload",
    category: "food",
    request: {
      title: "Strawberry mille-feuille launch",
      designType: "Instagram Post",
      dimensions: "1080x1350",
      platform: "Instagram",
      aspectRatio: "4:5",
      briefText:
        "Launch our new strawberry mille-feuille, ₦4,500 a slice, available from Monday. Commuters can order ahead for pickup from 7am.",
    },
  },
  {
    id: "valentine-box-upload",
    brand: {
      name: "Crumb & Co.",
      overview: "Neighbourhood bakery in Lekki, Lagos, baking French pastry.",
      tone: "Warm, unfussy, a little playful",
      primaryColor: "#FFF4E6",
      secondaryColor: "#C2410C",
    },
    hasLogo: true,
    imageSource: "upload",
    category: "offer",
    request: {
      title: "Valentine's dessert box",
      designType: "Instagram Post",
      dimensions: "1080x1080",
      platform: "Instagram",
      aspectRatio: "1:1",
      briefText:
        "Valentine's dessert box for two: six pastries and a handwritten card, ₦25,000. Pre-orders close 12 February.",
    },
  },
  {
    id: "fintech-ko",
    brand: {
      name: "Kudi Bridge",
      overview: "Mobile app for sending money across Africa.",
      targetAudience:
        "Young professionals supporting family in other countries",
      tone: "Confident, plain-spoken, trustworthy",
      primaryColor: "#0B1F3A",
      secondaryColor: "#22C55E",
    },
    hasLogo: true,
    imageSource: "ko",
    category: "finance",
    request: {
      title: "Zero-fee launch month",
      designType: "Instagram Post",
      dimensions: "1080x1350",
      platform: "Instagram",
      aspectRatio: "4:5",
      briefText:
        "Send money to 20 African countries with zero transfer fees for your first month. Download the app to start.",
    },
  },
  {
    id: "conference-ko",
    brand: {
      name: "Lagos Design Week",
      overview: "Annual festival of African design and architecture.",
      tone: "Curious, bold, editorial",
      primaryColor: "#111111",
      secondaryColor: "#F59E0B",
    },
    hasLogo: true,
    imageSource: "ko",
    category: "event",
    request: {
      title: "Panel announcement",
      designType: "Instagram Post",
      dimensions: "1080x1080",
      platform: "Instagram",
      aspectRatio: "1:1",
      briefText:
        "Announce our panel 'Building for Heat' with architect Ada Obi, Friday 14 March at 4pm, Landmark Centre. Free registration, limited seats.",
    },
  },
  {
    id: "recruitment-ko",
    brand: {
      name: "Paystack-style Labs",
      overview: "Payments infrastructure company with engineers across Africa.",
      tone: "Direct, warm, ambitious",
      primaryColor: "#0F172A",
      secondaryColor: "#38BDF8",
    },
    hasLogo: false,
    imageSource: "ko",
    category: "recruitment",
    request: {
      title: "Senior React engineers",
      designType: "LinkedIn Post",
      dimensions: "1200x1200",
      platform: "LinkedIn",
      aspectRatio: "1:1",
      briefText:
        "We're hiring two senior React engineers, fully remote anywhere in Africa. Apply by 30 November.",
    },
  },
  {
    id: "eid-greeting-ko",
    brand: {
      name: "MedPlus Pharmacy",
      overview: "Community pharmacy chain in Abuja and Kano.",
      tone: "Caring, respectful",
      primaryColor: "#065F46",
      secondaryColor: "#FDE68A",
    },
    hasLogo: true,
    imageSource: "ko",
    category: "celebration",
    request: {
      title: "Eid greeting",
      designType: "Instagram Story",
      dimensions: "1080x1920",
      platform: "Instagram",
      aspectRatio: "9:16",
      briefText:
        "Eid Mubarak greeting to our customers and their families. No promotion, just warm wishes.",
    },
  },
  {
    id: "fitness-ko",
    brand: {
      name: "Yaba Strong",
      overview: "Small-group strength and HIIT studio in Yaba.",
      targetAudience: "Busy professionals who train before work",
      tone: "Energetic, encouraging",
      primaryColor: "#18181B",
      secondaryColor: "#F43F5E",
    },
    hasLogo: true,
    imageSource: "ko",
    category: "service",
    request: {
      title: "6am HIIT class",
      designType: "Instagram Post",
      dimensions: "1080x1350",
      platform: "Instagram",
      aspectRatio: "4:5",
      briefText:
        "New 6am HIIT class every weekday at our Yaba studio. Your first class is free; book on WhatsApp.",
    },
  },
];

/* Frozen with the feature. The structural rules (two directions, layouts
   apart, contract limits) are enforced in code after the model answers, so
   anything below 1.0 there is a bug, not a bad day. The quality numbers are
   the model's own and carry a margin. */
export const DIRECTIONS_EVAL_THRESHOLDS = {
  minTwoDirections: 1,
  minLayoutsDiffer: 1,
  minWithinLimits: 1,
  /** Share of "why this works" reasons that name something from the brief or
   *  the brand (text-overlap.ts, isGroundedReason). */
  minGroundedShare: 0.8,
  /** Share that are praise any design could claim and name nothing. */
  maxFillerShare: 0.1,
  /** Share that read out the spec (a layout id, a hex code) or the prompt. */
  maxJargonShare: 0,
  /** Share shown shortened. A cut sentence reads as one that broke off, so
   *  the finaliser prefers whole ones; this says how often it could not. */
  maxCutShare: 0.2,
  /** Mean of 1 - worst word overlap between a case's two directions. */
  minMeanDistinctness: 0.7,
  /** Pairs still near-duplicate after the redraft rule. */
  maxFinalNearDuplicates: 0,
} as const;
