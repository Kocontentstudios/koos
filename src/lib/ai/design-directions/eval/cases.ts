import type { DesignCategory } from "@/lib/ai/design-training/playbooks";
import type { BrandSummary } from "@/lib/ai/prompts/strategy";
import type { PriorDirection } from "@/lib/jobs/directions/brief";

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
  /** The product the brief names, when it names one: every direction must
   *  name it, and on KO cases every plate must show it. */
  product?: string;
  /** Set for a regenerate: one direction, apart from both of these. */
  regenerate?: { existing: PriorDirection[] };
  /** The upload's file, normalised as the browser does before the loader
   *  sees it. Upload cases without one use --image. */
  imageFile?: string;
  /** The loader must refuse this upload; the case passes only if it does. */
  expectRefused?: boolean;
}

/** Where the fixture photographs live: royalty-free stock, kept out of the
 *  repo because they are binaries. */
export const EVAL_FIXTURES = "/tmp/feat-033/fixtures";

const CRUMB: BrandSummary = {
  name: "Crumb & Co.",
  overview: "Neighbourhood bakery in Lekki, Lagos, baking French pastry.",
  targetAudience: "Commuters and weekend brunch regulars",
  tone: "Warm, unfussy, a little playful",
  primaryColor: "#FFF4E6",
  secondaryColor: "#C2410C",
  additionalColors: ["#3B2416"],
};

const BAKERY_REQUEST = {
  title: "Strawberry mille-feuille launch",
  designType: "Instagram Post",
  dimensions: "1080x1350",
  platform: "Instagram",
  aspectRatio: "4:5" as const,
  briefText:
    "Launch our new strawberry mille-feuille, ₦4,500 a slice, available from Monday. Commuters can order ahead for pickup from 7am.",
};

const LOOM: BrandSummary = {
  name: "Lagos Loom",
  overview: "Handwoven aso-oke textiles for modern homes.",
  tone: "Warm and confident",
  primaryColor: "#0F172A",
  secondaryColor: "#F97316",
};

/* From variant a's eval, where "12 Artisans" was written for a brief about
   twelve throws: the case that tests a count borrowed from another noun. */
const LOOM_REQUEST = {
  title: "Autumn collection launch",
  designType: "Instagram Post",
  dimensions: "1080x1350",
  platform: "Instagram",
  aspectRatio: "4:5" as const,
  briefText:
    "Announce the autumn aso-oke collection, launching 3 November. Twelve new throws and cushions in rust and indigo, each woven by one artisan in Iseyin.",
};

export const DIRECTIONS_EVAL_CASES: DirectionsEvalCase[] = [
  {
    id: "bakery-upload",
    brand: CRUMB,
    hasLogo: true,
    imageSource: "upload",
    category: "food",
    request: BAKERY_REQUEST,
    product: "strawberry mille-feuille",
  },
  /* The live run's brief on KO imagery: round 1 painted a tart, a cake and
     bread rolls for it. */
  {
    id: "bakery-ko",
    brand: CRUMB,
    hasLogo: true,
    imageSource: "ko",
    category: "food",
    request: BAKERY_REQUEST,
    product: "strawberry mille-feuille",
  },
  {
    id: "textile-launch-ko",
    brand: LOOM,
    hasLogo: true,
    imageSource: "ko",
    category: "product",
    request: LOOM_REQUEST,
    product: "aso-oke throws",
  },
  {
    id: "textile-launch-regenerate",
    brand: LOOM,
    hasLogo: true,
    imageSource: "ko",
    category: "product",
    request: LOOM_REQUEST,
    product: "aso-oke throws",
    regenerate: {
      existing: [
        {
          title: "Countdown to launch",
          layout: "hero-center",
          headline: "3 November: autumn arrives",
          subheadline: "Twelve new throws and cushions in rust and indigo",
          cta: "Shop the collection",
          backgroundPrompt:
            "a stack of rust and indigo aso-oke throws on a wooden bench",
        },
        {
          title: "The weaver's hand",
          layout: "split-left",
          headline: "Woven by one artisan in Iseyin",
          subheadline: "Each throw from one loom, one pair of hands",
          cta: "See the collection",
          backgroundPrompt: "hands at a narrow-strip loom weaving indigo cloth",
        },
      ],
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
  /* Round 3: real photographs. A busy scene where copy must find the one
     calm area, and a portrait where copy may never cover the face. */
  {
    id: "cafe-photo-upload",
    brand: {
      name: "Brew Lab",
      overview: "Specialty coffee bar in Yaba, Lagos.",
      targetAudience: "Remote workers and students",
      tone: "Easygoing, curious, precise about coffee",
      primaryColor: "#1C1917",
      secondaryColor: "#D97706",
    },
    hasLogo: false,
    imageSource: "upload",
    category: "food",
    imageFile: `${EVAL_FIXTURES}/busy-cafe-espresso.jpg`,
    request: {
      title: "Espresso flight launch",
      designType: "Instagram Post",
      dimensions: "1080x1080",
      platform: "Instagram",
      aspectRatio: "1:1",
      briefText:
        "Our new single-origin espresso flight is here: three shots for ₦6,000, every weekday from 8am at our Yaba bar. Walk in, no booking needed.",
    },
    product: "single-origin espresso flight",
  },
  {
    id: "fashion-portrait-upload",
    brand: {
      name: "Adire House",
      overview: "Contemporary adire womenswear studio in Ikoyi, Lagos.",
      targetAudience: "Women who dress for work and weekends in one wardrobe",
      tone: "Assured, warm, unhurried",
      primaryColor: "#F5F0E6",
      secondaryColor: "#1E3A8A",
    },
    hasLogo: false,
    imageSource: "upload",
    category: "product",
    imageFile: `${EVAL_FIXTURES}/portrait-fashion.jpg`,
    request: {
      title: "Harmattan dress pre-order",
      designType: "Instagram Post",
      dimensions: "1080x1350",
      platform: "Instagram",
      aspectRatio: "4:5",
      briefText:
        "Pre-orders open for the Harmattan linen dress, ₦38,000, from Friday 1 November on adirehouse.ng.",
    },
    product: "Harmattan linen dress",
  },
  /* Round-2 live run: a near-blank white photo was accepted and became two
     designs' hero. The loader must refuse it. */
  {
    id: "workshop-blank-upload",
    brand: CRUMB,
    hasLogo: true,
    imageSource: "upload",
    category: "event",
    imageFile: `${EVAL_FIXTURES}/photo-a.jpg`,
    expectRefused: true,
    request: {
      title: "Kids' croissant workshop",
      designType: "Instagram Post",
      dimensions: "1080x1080",
      platform: "Instagram",
      aspectRatio: "1:1",
      briefText:
        "Kids' croissant-making workshop this Saturday, 10am to 12pm at our Lekki shop. ₦15,000 per child, ages 7 to 12, only 8 spots. Book on WhatsApp 0803 555 0142.",
    },
  },
];

/* Round 2, frozen before the run. Two lanes:
   - delivered: enforced in code after the model answers, so anything short
     of these is a bug, not a bad day;
   - model: the model's own first answer, before the fit pass rewrites it and
     before finalize.ts settles it. These carry a margin because the model is
     non-deterministic, and they are what says the prompt works. */
export const DIRECTIONS_EVAL_THRESHOLDS = {
  minCountRight: 1,
  minLayoutsDiffer: 1,
  minWithinLimits: 1,
  /** Model drafts with every field inside the contract unaided. Round 1
   *  measured 0.14 and 0.71 on the same prompt. */
  minModelWithinLimits: 0.8,
  /** Model reasons naming a specific fact of the brief, or two of its words
   *  (finalize.ts, isGrounded). Round 1's 0.77 was on a one-word rule. */
  minModelGroundedShare: 0.8,
  /** Model reasons claiming a position, size or light. */
  maxModelSpatialShare: 0.1,
  /** Model copy fields and reasons stating a fact the brief does not hold. */
  maxModelInventedShare: 0.05,
  /** Model reasons that read as unfinished. */
  maxModelCutOffShare: 0.05,
  minGroundedShare: 0.8,
  maxFillerShare: 0.1,
  maxJargon: 0,
  maxSpatial: 0,
  maxCutOff: 0,
  /** Delivered reasons not true of the delivered copy. */
  maxFalseClaims: 0,
  maxInvented: 0,
  /** Mean of 1 - worst word overlap: the pair, or the regenerated direction
   *  against both existing ones. */
  minMeanDistinctness: 0.7,
  maxFinalNearDuplicates: 0,
  /** Product cases where every direction named the brief's product. */
  minProductNamed: 1,
  /** KO plates for a product case that show it, by the eval's own look; a
   *  plate drawn flat after two misses counts as not showing it. */
  minPlateShowsProduct: 0.8,
  /** Delivered plates showing something else: what round 1 shipped. */
  maxWrongProductPlates: 0,
} as const;
