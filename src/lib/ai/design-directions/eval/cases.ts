import type { DesignCategory } from "@/lib/ai/design-training/playbooks";
import type { BrandSummary } from "@/lib/ai/prompts/strategy";
import type { PriorDirection } from "@/lib/jobs/directions/brief";
import { READ_EVAL_CASES } from "./read-cases";
import type { LabelledFact, LabelledOffering } from "./read-score";

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
  /** Run each direction through the gate's correction path for real
   *  (round 4): the judge prescribes on the rendered pixels and the job's
   *  own rules keep or refuse it. Round 5 adds corrections that change the
   *  copy, held to the same rules. */
  probeCorrection?: boolean;
  /** The brief's hard facts, labelled by hand in its own words (round 5):
   *  what coverage is measured against, independent of the reader, and
   *  what the reader is scored against (read-score.ts). */
  facts: LabelledFact[];
  /** What the brief offers, when two careful readers would agree. */
  offering?: LabelledOffering;
  /** The real people the brief names. */
  people?: string[];
}

const readCase = (id: string) => {
  const found = READ_EVAL_CASES.find((c) => c.id === id);
  if (!found) throw new Error(`no read case ${id}`);
  return found;
};

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

const BAKERY_FACTS: LabelledFact[] = [
  { text: "₦4,500 a slice" },
  { text: "from Monday" },
  { text: "from 7am" },
  { text: "pickup from 7am", optional: true },
  { text: "order ahead", optional: true },
];

const LOOM: BrandSummary = {
  name: "Lagos Loom",
  overview: "Handwoven aso-oke textiles for modern homes.",
  tone: "Warm and confident",
  primaryColor: "#0F172A",
  secondaryColor: "#F97316",
};

/* From variant a's eval, where "12 Artisans" was written for a brief about
   twelve throws: the case that tests a count borrowed from another noun. */
const LOOM_FACTS: LabelledFact[] = [
  { text: "3 November" },
  { text: "launching 3 November", optional: true },
  { text: "Twelve new throws and cushions", optional: true },
  { text: "Iseyin", optional: true },
  { text: "each woven by one artisan in Iseyin", optional: true },
];

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
    facts: BAKERY_FACTS,
    offering: { kind: "product", phrases: ["strawberry mille-feuille"] },
  },
  /* The live run's brief on KO imagery: round 1 painted a tart, a cake and
     bread rolls for it. */
  {
    id: "bakery-ko",
    probeCorrection: true,
    brand: CRUMB,
    hasLogo: true,
    imageSource: "ko",
    category: "food",
    request: BAKERY_REQUEST,
    product: "strawberry mille-feuille",
    facts: BAKERY_FACTS,
    offering: { kind: "product", phrases: ["strawberry mille-feuille"] },
  },
  {
    id: "textile-launch-ko",
    brand: LOOM,
    hasLogo: true,
    imageSource: "ko",
    category: "product",
    request: LOOM_REQUEST,
    product: "aso-oke throws",
    facts: LOOM_FACTS,
  },
  {
    id: "textile-launch-regenerate",
    brand: LOOM,
    hasLogo: true,
    imageSource: "ko",
    category: "product",
    request: LOOM_REQUEST,
    product: "aso-oke throws",
    facts: LOOM_FACTS,
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
    facts: [
      { text: "₦25,000" },
      { text: "12 February" },
      { text: "Pre-orders close 12 February", optional: true },
      { text: "for two", optional: true },
      { text: "six pastries and a handwritten card", optional: true },
    ],
    offering: {
      kind: "product",
      phrases: ["Valentine's dessert box", "dessert box"],
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
    facts: [
      { text: "20 African countries" },
      { text: "zero transfer fees" },
      { text: "first month" },
      { text: "zero transfer fees for your first month", optional: true },
      { text: "Download the app", optional: true },
    ],
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
    facts: readCase("panel-named-speaker").facts,
    offering: readCase("panel-named-speaker").offering,
    people: ["Ada Obi"],
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
    facts: [
      { text: "two" },
      { text: "two senior React engineers", optional: true },
      { text: "fully remote" },
      { text: "anywhere in Africa" },
      { text: "fully remote anywhere in Africa", optional: true },
      { text: "30 November" },
      { text: "Apply by 30 November", optional: true },
    ],
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
    facts: [],
    offering: { kind: "none", phrases: [] },
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
    facts: [
      { text: "6am" },
      { text: "every weekday" },
      { text: "Yaba studio" },
      { text: "first class is free" },
      { text: "Your first class is free", optional: true },
      { text: "WhatsApp" },
    ],
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
    probeCorrection: true,
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
    facts: [
      { text: "₦6,000" },
      { text: "three shots" },
      { text: "three shots for ₦6,000", optional: true },
      { text: "every weekday" },
      { text: "from 8am" },
      { text: "Yaba bar" },
      { text: "no booking needed" },
      { text: "Walk in, no booking needed", optional: true },
    ],
    offering: {
      kind: "product",
      phrases: ["single-origin espresso flight", "espresso flight"],
    },
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
    facts: [
      { text: "₦38,000" },
      { text: "Friday 1 November" },
      { text: "from Friday 1 November", optional: true },
      { text: "adirehouse.ng" },
      { text: "Pre-orders open", optional: true },
    ],
    offering: {
      kind: "product",
      phrases: ["Harmattan linen dress", "linen dress"],
    },
  },
  /* Round-3 live critic: the age limit and the street address were dropped
     from both directions while coverage read 1.00, the quote card shrank
     its headline under the footer, and the phone number sat beside a time. */
  {
    id: "masterclass-ko",
    brand: {
      name: "Pour House Coffee",
      overview: "Specialty coffee bar in Yaba, Lagos.",
      targetAudience: "Remote workers and students",
      tone: "Easygoing, curious, precise about coffee",
      offer: "Single-origin espresso and pour-over",
      primaryColor: "#1C1917",
      secondaryColor: "#D97706",
      additionalColors: ["#F5F5F4"],
    },
    hasLogo: true,
    imageSource: "ko",
    category: "event",
    request: {
      title: "Latte art masterclass",
      designType: "Instagram Post",
      dimensions: "1080x1080",
      platform: "Instagram",
      aspectRatio: "1:1",
      briefText:
        "Latte art masterclass on Sunday 9 November, 2pm to 5pm, at our Yaba bar, 12 Herbert Macaulay Way. ₦25,000 per person, ages 16 and up, all milk and beans included, 10 seats. Call or WhatsApp 0812 444 7781 to book.",
    },
    facts: [
      { text: "Sunday 9 November" },
      { text: "2pm to 5pm" },
      { text: "Yaba bar" },
      { text: "12 Herbert Macaulay Way" },
      { text: "₦25,000 per person" },
      { text: "ages 16 and up" },
      { text: "all milk and beans included" },
      { text: "10 seats" },
      { text: "Call or WhatsApp 0812 444 7781" },
    ],
    offering: {
      kind: "event",
      phrases: ["latte art masterclass"],
    },
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
    facts: [],
  },
  /* Round 6: held out. Rounds 4 and 5 copied the critic's own live briefs
     into the cases, so a pass on them said nothing about new briefs
     (round-5 live critic). These are written fresh, in shapes the critics
     found broken: a portrait photo on a 16:9 canvas, a service with no
     product (whose plates kept painting lettered paper), an event naming a
     real person, a 24 MP storefront with two prices and their units, and a
     landscape on a 9:16 story. */
  {
    id: "kimono-wide-upload",
    probeCorrection: true,
    brand: {
      name: "Ofe Studio",
      overview: "Linen and adire womenswear studio in Victoria Island, Lagos.",
      targetAudience: "Women who want one jacket for work and weekends",
      tone: "Calm, precise, quietly confident",
      primaryColor: "#EEF2EA",
      secondaryColor: "#365314",
    },
    hasLogo: false,
    imageSource: "upload",
    category: "product",
    imageFile: `${EVAL_FIXTURES}/portrait-fashion.jpg`,
    request: {
      title: "Ofe kimono jacket",
      designType: "Twitter Post",
      dimensions: "1600x900",
      platform: "Twitter",
      aspectRatio: "16:9",
      briefText:
        "The Ofe linen kimono jacket in sage, hand-finished with wooden toggles. ₦58,000, sizes S to L, only 20 pieces. Try it on at 12 Ozumba Mbadiwe Avenue, Victoria Island, Monday to Friday, 10am to 6pm.",
    },
    product: "linen kimono jacket",
    facts: [
      { text: "₦58,000" },
      { text: "sizes S to L" },
      { text: "only 20 pieces" },
      { text: "12 Ozumba Mbadiwe Avenue, Victoria Island" },
      { text: "Monday to Friday" },
      { text: "10am to 6pm" },
    ],
    offering: {
      kind: "product",
      phrases: ["Ofe linen kimono jacket", "linen kimono jacket"],
    },
  },
  {
    id: "tutoring-ko",
    brand: {
      name: "Sum Up Tutors",
      overview: "Home tutoring for secondary school students in Lagos.",
      targetAudience: "Parents of SS1 to SS3 students",
      tone: "Reassuring, plain, encouraging",
      primaryColor: "#F8FAFC",
      secondaryColor: "#7C3AED",
    },
    hasLogo: true,
    imageSource: "ko",
    category: "service",
    request: {
      title: "Maths and physics tutoring",
      designType: "Instagram Post",
      dimensions: "1080x1350",
      platform: "Instagram",
      aspectRatio: "4:5",
      briefText:
        "Home maths and physics tutoring for SS1 to SS3 students in Surulere and Yaba. Two 90-minute sessions a week for ₦45,000 a month, and the first session is free. Text 0812 444 7781 to book a slot.",
    },
    facts: [
      { text: "SS1 to SS3" },
      { text: "Surulere and Yaba" },
      { text: "Two 90-minute sessions a week" },
      { text: "₦45,000 a month" },
      { text: "the first session is free" },
      { text: "0812 444 7781" },
    ],
    offering: {
      kind: "service",
      phrases: [
        "home maths and physics tutoring",
        "maths and physics tutoring",
      ],
    },
  },
  {
    id: "pottery-evening-ko",
    probeCorrection: true,
    brand: {
      name: "Clay Room",
      overview: "Pottery studio in Surulere, Lagos.",
      targetAudience: "Adults looking for a hands-on evening out",
      tone: "Warm, tactile, unpretentious",
      primaryColor: "#FAF5EF",
      secondaryColor: "#9A3412",
    },
    hasLogo: true,
    imageSource: "ko",
    category: "event",
    request: {
      title: "Wheel-throwing evening",
      designType: "Instagram Post",
      dimensions: "1080x1080",
      platform: "Instagram",
      aspectRatio: "1:1",
      briefText:
        "Wheel-throwing evening with ceramicist Bisi Adeleke on Thursday 20 November, 6pm to 9pm, at Clay Room, 14 Bode Thomas Street, Surulere. ₦25,000 a seat, clay and firing included. Adults only, 18+. Just 10 seats. WhatsApp 0703 666 1294 to book.",
    },
    facts: [
      { text: "Thursday 20 November" },
      { text: "6pm to 9pm" },
      { text: "14 Bode Thomas Street, Surulere" },
      { text: "₦25,000 a seat" },
      { text: "clay and firing included" },
      { text: "18+" },
      { text: "10 seats" },
      { text: "0703 666 1294" },
      { text: "Clay Room", optional: true },
      { text: "Adults only", optional: true },
    ],
    offering: { kind: "event", phrases: ["wheel-throwing evening"] },
    people: ["Bisi Adeleke"],
  },
  {
    id: "storefront-reopening-upload",
    brand: {
      name: "Iya Basira Fabrics",
      overview: "Ankara and lace fabric shop in Balogun Market, Lagos Island.",
      targetAudience: "Tailors and families shopping for occasions",
      tone: "Bright, generous, straight to the point",
      primaryColor: "#FFFBEB",
      secondaryColor: "#B91C1C",
    },
    hasLogo: false,
    imageSource: "upload",
    category: "offer",
    imageFile: `${EVAL_FIXTURES}/busy-storefront-24mp.jpg`,
    request: {
      title: "Shop reopening",
      designType: "Instagram Post",
      dimensions: "1080x1350",
      platform: "Instagram",
      aspectRatio: "4:5",
      briefText:
        "Our fabric shop reopens on Saturday 6 December. Ankara from ₦6,500 a yard and lace bundles at ₦38,000 for 5 yards. Shop 12, Balogun Market, Lagos Island, open 9am to 5pm. Call 0802 333 4567.",
    },
    facts: [
      { text: "Saturday 6 December" },
      { text: "₦6,500 a yard" },
      { text: "₦38,000 for 5 yards" },
      { text: "Shop 12, Balogun Market, Lagos Island" },
      { text: "9am to 5pm" },
      { text: "0802 333 4567" },
    ],
  },
  {
    id: "retreat-sky-upload",
    brand: {
      name: "Stillwater Retreats",
      overview: "Small-group yoga retreats near Ibadan, Oyo State.",
      targetAudience: "City professionals who need a quiet weekend",
      tone: "Spacious, gentle, specific",
      primaryColor: "#F1F5F9",
      secondaryColor: "#0F766E",
    },
    hasLogo: false,
    imageSource: "upload",
    category: "event",
    imageFile: `${EVAL_FIXTURES}/sky-over-stone.jpg`,
    request: {
      title: "December yoga retreat",
      designType: "Instagram Story",
      dimensions: "1080x1920",
      platform: "Instagram",
      aspectRatio: "9:16",
      briefText:
        "Weekend yoga retreat outside Ibadan, Friday 12 December to Sunday 14 December. ₦120,000 per person, with a shared room and all meals included. 16 places. Book at stillwater.ng.",
    },
    facts: [
      { text: "Friday 12 December to Sunday 14 December" },
      { text: "₦120,000 per person" },
      { text: "a shared room and all meals included" },
      { text: "16 places" },
      { text: "stillwater.ng" },
    ],
    offering: {
      kind: "event",
      phrases: ["weekend yoga retreat", "yoga retreat"],
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
