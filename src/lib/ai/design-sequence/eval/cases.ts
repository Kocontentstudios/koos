import type { BrandSummary } from "@/lib/ai/prompts/strategy";
import type {
  SequenceImageSource,
  SequenceKind,
} from "@/lib/design/sequence/contract";
import type { BriefFactKind } from "@/lib/jobs/directions/brief-facts";

/**
 * Fixture briefs for the sequence planner eval (KOOS-AI-002): four
 * carousels (a cafe, a textile store, a SaaS launch, an event) and two
 * presentations, each run at 3, 5 and 8 frames. Facts are labelled by hand
 * in the brief's own words, so coverage is measured against the labels and
 * never against the brief reader the planner itself uses.
 *
 * SEQUENCE_EVAL_CASES is the tuning set: rounds 1 to 3 read its runs to
 * change the prompt. SEQUENCE_HELD_OUT_CASES was written on 2026-10-30,
 * after the round-3 critic found the prompt quoting tuning-set hooks, and
 * is never read to change the prompt: its score is reported on its own
 * (--set held-out), as the measure of whether the planner generalises.
 * No phrase of either set may appear in the prompt (prompt-leak.test.ts).
 * Every brand profile carries the fields a thin brief may borrow points
 * from (profilePoints), so that path is measured, not only unit-tested.
 */

export interface LabelledSequenceFact {
  kind: BriefFactKind;
  text: string;
}

export interface SequenceEvalCase {
  id: string;
  kind: SequenceKind;
  brand: BrandSummary;
  hasLogo: boolean;
  imageSource: SequenceImageSource;
  request: {
    title: string;
    designType: string;
    platform: string;
    aspectRatio: "1:1" | "4:5" | "9:16" | "16:9";
    briefText: string;
  };
  /** What the brief offers, in its words: the hook must name it. */
  offering: string;
  facts: LabelledSequenceFact[];
}

export const FRAME_COUNTS = [3, 5, 8] as const;

export const SEQUENCE_EVAL_CASES: SequenceEvalCase[] = [
  {
    id: "cafe",
    kind: "carousel",
    brand: {
      name: "Kiln Coffee",
      overview: "Specialty coffee bar in Yaba, Lagos",
      targetAudience: "Students and young professionals in Yaba",
      tone: "Warm, unhurried, a little playful",
      offer: "Specialty coffee and cold brew from Nigerian-grown beans",
      values: "Patience over shortcuts; coffee that tastes of where it grew",
      differentiators:
        "Beans from the Mambilla Plateau, roasted in-house each week",
      primaryGoal: "Make the Yaba bar a weekend habit for students",
      primaryColor: "#1F2A24",
      secondaryColor: "#D9822B",
    },
    hasLogo: true,
    imageSource: "ko",
    request: {
      title: "Cold brew launch",
      designType: "Instagram carousel",
      platform: "Instagram",
      aspectRatio: "4:5",
      briefText:
        "Launch our cold brew at our Yaba bar. It is steeped for 18 hours and served over ice. ₦2,500 a bottle. Launch day is Saturday 15 November, 8am to 2pm. WhatsApp 0803 555 0142 to reserve a bottle.",
    },
    offering: "cold brew",
    facts: [
      { kind: "place", text: "our Yaba bar" },
      { kind: "price", text: "₦2,500 a bottle" },
      { kind: "date", text: "Saturday 15 November" },
      { kind: "time", text: "8am to 2pm" },
      { kind: "contact", text: "WhatsApp 0803 555 0142" },
    ],
  },
  {
    id: "textile",
    kind: "carousel",
    brand: {
      name: "Adire House",
      overview:
        "Textile store in Surulere selling hand-dyed adire from Abeokuta",
      targetAudience: "Women 25-45 who sew their own outfits",
      tone: "Proud, craft-led, direct",
      offer: "Hand-dyed adire cloth sold by the piece",
      values: "Keeping the Abeokuta dyeing tradition paid and alive",
      differentiators:
        "Buys directly from the dyers; every piece is one of a kind",
      primaryGoal: "Sell each new batch before the next one arrives",
      primaryColor: "#1E3A8A",
      secondaryColor: "#F5EBDD",
    },
    hasLogo: true,
    imageSource: "ko",
    request: {
      title: "New indigo adire in store",
      designType: "Instagram carousel",
      platform: "Instagram",
      aspectRatio: "4:5",
      briefText:
        "New stock: hand-dyed indigo adire, made in Abeokuta. ₦18,000 for a 2-yard piece. Visit us at 14 Ogunlana Drive, Surulere, Tuesday to Saturday, 10am to 6pm. DM @adirehouse.ng to reserve a piece.",
    },
    offering: "hand-dyed indigo adire",
    facts: [
      { kind: "price", text: "₦18,000 for a 2-yard piece" },
      { kind: "place", text: "14 Ogunlana Drive, Surulere" },
      { kind: "day", text: "Tuesday to Saturday" },
      { kind: "time", text: "10am to 6pm" },
      { kind: "contact", text: "@adirehouse.ng" },
    ],
  },
  {
    id: "saas",
    kind: "carousel",
    brand: {
      name: "Ledgerly",
      overview: "Invoicing app for Nigerian freelancers",
      targetAudience: "Freelance designers, writers and developers",
      tone: "Clear, confident, friendly",
      offer: "Invoicing and payment reminders in naira and dollars",
      values:
        "Freelancers should spend their time on the work, not on chasing payment",
      differentiators:
        "Built for Nigerian freelancers billing clients at home and abroad",
      primaryGoal: "Sign up freelancers who invoice clients every month",
      primaryColor: "#0F766E",
      secondaryColor: "#F0FDFA",
    },
    hasLogo: true,
    imageSource: "none",
    request: {
      title: "Ledgerly launch",
      designType: "LinkedIn carousel",
      platform: "LinkedIn",
      aspectRatio: "1:1",
      briefText:
        "Ledgerly launches on 3 March. Send an invoice in naira or dollars in under a minute, and get a reminder sent for you when a client pays late. Free for your first 3 months. Sign up at ledgerly.app.",
    },
    offering: "Ledgerly",
    facts: [
      { kind: "date", text: "3 March" },
      { kind: "offer", text: "Free for your first 3 months" },
      { kind: "contact", text: "ledgerly.app" },
    ],
  },
  {
    id: "event",
    kind: "carousel",
    brand: {
      name: "Crumb & Co.",
      overview: "Neighbourhood bakery in Ikoyi, Lagos",
      targetAudience: "Parents of teenagers in Ikoyi and Lekki",
      tone: "Warm and unfussy",
      offer: "Sourdough, pastries and baking classes",
      values: "Real bread, made slowly, taught generously",
      differentiators:
        "Every class is taught by our own bakers in our working kitchen",
      primaryGoal: "Fill every weekend class",
      primaryColor: "#FFF4E6",
      secondaryColor: "#C2410C",
    },
    hasLogo: true,
    imageSource: "ko",
    request: {
      title: "Teen sourdough class",
      designType: "Instagram carousel",
      platform: "Instagram",
      aspectRatio: "4:5",
      briefText:
        "Teen sourdough baking class with head baker Tunde Okafor. Saturday 22 November, 10am to 1pm, at 9 Bourdillon Road, Ikoyi. ₦25,000 per person, apron and starter to take home. Only 12 places. Book on WhatsApp 0812 345 6789.",
    },
    offering: "Teen sourdough baking class",
    facts: [
      { kind: "date", text: "Saturday 22 November" },
      { kind: "time", text: "10am to 1pm" },
      { kind: "place", text: "9 Bourdillon Road, Ikoyi" },
      { kind: "price", text: "₦25,000 per person" },
      { kind: "offer", text: "apron and starter to take home" },
      { kind: "quantity", text: "12 places" },
      { kind: "contact", text: "WhatsApp 0812 345 6789" },
    ],
  },
  {
    id: "pitch-deck",
    kind: "presentation",
    brand: {
      name: "Farmlink",
      overview:
        "Solar cold rooms for tomato farmers in Kano, rented by the crate",
      targetAudience: "Seed-stage investors",
      tone: "Plain, evidence-led",
      offer: "Pay-per-crate solar cold storage for smallholder farmers",
      values: "Farmers keep more of what they grow",
      differentiators:
        "No upfront cost for farmers; cold rooms run on solar, off the grid",
      primaryGoal: "Close the seed round to open cold rooms in new markets",
      primaryColor: "#14532D",
      secondaryColor: "#FEF3C7",
    },
    hasLogo: true,
    imageSource: "none",
    request: {
      title: "Farmlink seed round",
      designType: "Pitch deck",
      platform: "Investor meeting",
      aspectRatio: "16:9",
      briefText:
        "Pitch deck for our seed round. Farmlink rents solar cold rooms to tomato farmers in Kano by the crate. Farmers pay ₦500 per crate per day. We run 14 cold rooms today. We are raising $750,000. Contact founders@farmlink.ng.",
    },
    offering: "solar cold rooms",
    facts: [
      { kind: "place", text: "Kano" },
      { kind: "price", text: "₦500 per crate per day" },
      { kind: "quantity", text: "14 cold rooms" },
      { kind: "price", text: "$750,000" },
      { kind: "contact", text: "founders@farmlink.ng" },
    ],
  },
  {
    id: "partner-deck",
    kind: "presentation",
    brand: {
      name: "Lagos Design Week",
      overview: "Annual design festival in Lagos",
      targetAudience: "Brand partnership managers",
      tone: "Bold, cultured, concise",
      offer:
        "A week-long design festival of talks, exhibitions and a design market",
      values: "Design from Lagos, on its own terms",
      differentiators:
        "Brings designers, brands and buyers into one programme each December",
      primaryGoal: "Sign brand partners for the main stage and the market",
      primaryColor: "#111827",
      secondaryColor: "#F59E0B",
    },
    hasLogo: true,
    imageSource: "none",
    request: {
      title: "Partner with Lagos Design Week",
      designType: "Sponsorship presentation",
      platform: "Email to partners",
      aspectRatio: "16:9",
      briefText:
        "Sponsorship deck for Lagos Design Week 2026, 4 to 8 December at Landmark Centre, Victoria Island. Gold partner package ₦15,000,000 with naming on the main stage. Email partners@lagosdesignweek.ng.",
    },
    offering: "Lagos Design Week",
    facts: [
      { kind: "date", text: "4 to 8 December" },
      { kind: "place", text: "Landmark Centre, Victoria Island" },
      { kind: "price", text: "₦15,000,000" },
      { kind: "contact", text: "partners@lagosdesignweek.ng" },
    ],
  },
];

/**
 * Briefs the prompt was never tuned on. Two are thin on purpose (the
 * pepper sauce gives two facts, the laundry service four, at up to eight
 * frames), so a set has to borrow points from the brand profile rather
 * than repeat the brief's. One is text-led, one a presentation.
 */
export const SEQUENCE_HELD_OUT_CASES: SequenceEvalCase[] = [
  {
    id: "pepper-sauce",
    kind: "carousel",
    brand: {
      name: "Ata Kitchen",
      overview: "Small-batch Nigerian pepper sauces made in Ibadan",
      targetAudience: "Home cooks in Lagos and Ibadan who cook with heat",
      tone: "Bold, friendly, a little cheeky",
      offer: "Scotch bonnet pepper sauce in jars",
      values: "Real heat from real peppers, nothing artificial added",
      differentiators:
        "Peppers bought from smallholder farmers in Oyo, blended without preservatives",
      primaryGoal: "Turn first-time buyers into monthly reorders",
      primaryColor: "#B91C1C",
      secondaryColor: "#FDE68A",
    },
    hasLogo: true,
    imageSource: "ko",
    request: {
      title: "Pepper sauce restock",
      designType: "Instagram carousel",
      platform: "Instagram",
      aspectRatio: "4:5",
      briefText:
        "Our scotch bonnet pepper sauce is back in stock. ₦3,500 a 250ml jar. Order on WhatsApp 0809 222 7781.",
    },
    offering: "scotch bonnet pepper sauce",
    facts: [
      { kind: "price", text: "₦3,500 a 250ml jar" },
      { kind: "contact", text: "WhatsApp 0809 222 7781" },
    ],
  },
  {
    id: "laundry",
    kind: "carousel",
    brand: {
      name: "FreshFold",
      overview: "Laundry pickup and delivery service in Lekki",
      targetAudience: "Busy professionals and young families in Lekki",
      tone: "Calm, tidy, reassuring",
      offer: "Wash, dry and iron with free pickup and delivery",
      values: "Your weekend belongs to you, not to the washing",
      differentiators:
        "Every bag is washed separately, never mixed with another customer's",
      primaryGoal: "Win weekly subscribers in Lekki Phase 1",
      primaryColor: "#0E7490",
      secondaryColor: "#ECFEFF",
    },
    hasLogo: true,
    imageSource: "none",
    request: {
      title: "Laundry pickup in Lekki",
      designType: "Instagram carousel",
      platform: "Instagram",
      aspectRatio: "1:1",
      briefText:
        "Laundry pickup for Lekki Phase 1. We collect on Monday and bring your clothes back washed and ironed on Wednesday. ₦8,000 for a 10kg bag. Book at freshfold.ng.",
    },
    offering: "Laundry pickup",
    facts: [
      { kind: "place", text: "Lekki Phase 1" },
      { kind: "day", text: "Monday" },
      { kind: "day", text: "Wednesday" },
      { kind: "price", text: "₦8,000 for a 10kg bag" },
      { kind: "contact", text: "freshfold.ng" },
    ],
  },
  {
    id: "clinic",
    kind: "carousel",
    brand: {
      name: "Smile Studio",
      overview: "Dental clinic in Ikeja GRA",
      targetAudience: "Adults 25-50 in Ikeja who want a brighter smile",
      tone: "Warm, professional, plain-spoken",
      offer: "Check-ups, cleaning and teeth whitening",
      values: "Gentle care, explained before it starts",
      differentiators:
        "Every treatment is done by a licensed dentist, not an assistant",
      primaryGoal: "Book more whitening appointments on weekdays",
      primaryColor: "#1D4ED8",
      secondaryColor: "#F8FAFC",
    },
    hasLogo: true,
    imageSource: "ko",
    request: {
      title: "Teeth whitening offer",
      designType: "Instagram carousel",
      platform: "Instagram",
      aspectRatio: "4:5",
      briefText:
        "Teeth whitening at Smile Studio, Ikeja GRA. One 60-minute session. ₦45,000 for the month of December. Call 0701 234 9876 to book.",
    },
    offering: "Teeth whitening",
    facts: [
      { kind: "place", text: "Ikeja GRA" },
      { kind: "quantity", text: "One 60-minute session" },
      { kind: "price", text: "₦45,000" },
      { kind: "date", text: "December" },
      { kind: "contact", text: "Call 0701 234 9876" },
    ],
  },
  {
    id: "school-deck",
    kind: "presentation",
    brand: {
      name: "Ikorodu Code Club",
      overview: "Free after-school coding club at a public school in Ikorodu",
      targetAudience: "Corporate social responsibility leads at Lagos firms",
      tone: "Earnest, specific, hopeful",
      offer: "Weekly coding lessons for secondary school students",
      values: "Every child deserves a first line of code",
      differentiators:
        "Taught by volunteer engineers from the community, at no cost to families",
      primaryGoal: "Fund laptops so more students can join",
      primaryColor: "#7C3AED",
      secondaryColor: "#FAF5FF",
    },
    hasLogo: true,
    imageSource: "none",
    request: {
      title: "Fund our laptops",
      designType: "Fundraising presentation",
      platform: "Email to sponsors",
      aspectRatio: "16:9",
      briefText:
        "Fundraising deck for Ikorodu Code Club. 120 students learn to code with us each term. We need ₦6,000,000 for 30 laptops. Contact hello@ikorodu-codeclub.org.",
    },
    offering: "Ikorodu Code Club",
    facts: [
      { kind: "quantity", text: "120 students" },
      { kind: "price", text: "₦6,000,000" },
      { kind: "quantity", text: "30 laptops" },
      { kind: "contact", text: "hello@ikorodu-codeclub.org" },
    ],
  },
];

/**
 * Frozen before the first run (2026-10-30), the KOOS-AI-002 rubric's H13:
 * every deterministic check is an invariant the planner enforces or
 * repairs, so anything short of every run is a bug; the judge's three
 * scores are averages over every run judged, on its 1 to 5 scale.
 */
export const SEQUENCE_EVAL_THRESHOLDS = {
  count: 1,
  roles: 1,
  paletteShared: 1,
  layoutVariety: 1,
  factCoverage: 1,
  judgeHook: 4,
  judgeLastAction: 4,
  judgeNonRepetitive: 4,
} as const;
