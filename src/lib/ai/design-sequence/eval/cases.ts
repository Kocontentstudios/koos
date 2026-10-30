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
