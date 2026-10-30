import type { BrandSummary } from "@/lib/ai/prompts/strategy";
import type {
  SequenceImageSource,
  SequenceKind,
} from "@/lib/design/sequence/contract";
import type { BriefFactKind } from "@/lib/jobs/directions/brief-facts";

/**
 * Fixture briefs for the sequence planner eval (KOOS-AI-002), each run at
 * 3, 5 and 8 frames. Facts are labelled by hand
 * in the brief's own words, so coverage is measured against the labels and
 * never against the brief reader the planner itself uses.
 *
 * SEQUENCE_EVAL_CASES is the tuning set: seven carousels and three
 * presentations whose runs are read to change the planner and the prompt.
 * SEQUENCE_HELD_OUT_CASES is never read that way: its score is reported on
 * its own (--set held-out), as the measure of whether the planner
 * generalises.
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
  /* Held out in round 4, read by its builder to tune points.ts and a
     label, so tuning from round 5 on (round-4 critic, HIGH 4). */
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
 * Briefs written on 2026-10-30 for round 5, after the round-4 critic found
 * the previous held-out set had been read to tune the planner. Nothing in
 * the planner or the prompt has been changed with their runs in view: the
 * runner prints only their aggregate (run.mts, --set held-out), and the
 * plans go to a report file nobody tuning the planner reads. Two are thin
 * on purpose (the tailor gives four facts, the car wash four, at up to
 * eight frames), one is text-led, one is a presentation.
 */
export const SEQUENCE_HELD_OUT_CASES: SequenceEvalCase[] = [
  {
    id: "tailor",
    kind: "carousel",
    brand: {
      name: "Stitchwell",
      overview: "Tailoring and alterations studio in Wuse 2, Abuja",
      targetAudience:
        "Office workers in Wuse and Maitama who buy their clothes off the rack",
      tone: "Neat, friendly, precise",
      offer: "Alterations, repairs and made-to-measure shirts",
      values: "Clothes should fit the person wearing them, not the hanger",
      differentiators:
        "Every garment is pinned on you before a stitch is cut; all work is done in our own workroom",
      primaryGoal: "Turn one-off alteration customers into regulars",
      primaryColor: "#3F2A1D",
      secondaryColor: "#F3E9DC",
    },
    hasLogo: true,
    imageSource: "ko",
    request: {
      title: "Trouser hemming",
      designType: "Instagram carousel",
      platform: "Instagram",
      aspectRatio: "4:5",
      briefText:
        "Alterations at Stitchwell, Wuse 2. Trousers hemmed for ₦3,000, ready in 3 days. Drop off at Plot 12 Aminu Kano Crescent. Call 0805 111 2233.",
    },
    offering: "Alterations",
    facts: [
      { kind: "price", text: "₦3,000" },
      { kind: "condition", text: "ready in 3 days" },
      { kind: "place", text: "Plot 12 Aminu Kano Crescent" },
      { kind: "contact", text: "Call 0805 111 2233" },
    ],
  },
  {
    id: "car-wash",
    kind: "carousel",
    brand: {
      name: "Shine Mobile",
      overview:
        "Mobile car wash that comes to office car parks in Port Harcourt",
      targetAudience: "Office workers in GRA Phase 2 who drive to work",
      tone: "Upbeat, practical",
      offer: "Exterior wash and interior vacuum at your parking spot",
      values: "Your lunch break belongs to you, not to your car",
      differentiators:
        "A waterless wash that leaves no puddles in the car park; every washer is trained and insured",
      primaryGoal: "Sign up whole offices for a weekly wash",
      primaryColor: "#0B3D2E",
      secondaryColor: "#E7F6EF",
    },
    hasLogo: true,
    imageSource: "none",
    request: {
      title: "Car wash at your office",
      designType: "Instagram carousel",
      platform: "Instagram",
      aspectRatio: "1:1",
      briefText:
        "We come to your office car park in GRA Phase 2 and wash your car while you work. ₦6,000 a wash, interior included. Book on WhatsApp 0816 404 5050.",
    },
    offering: "wash your car",
    facts: [
      { kind: "place", text: "GRA Phase 2" },
      { kind: "price", text: "₦6,000 a wash" },
      { kind: "offer", text: "interior included" },
      { kind: "contact", text: "WhatsApp 0816 404 5050" },
    ],
  },
  {
    id: "exam-prep",
    kind: "carousel",
    brand: {
      name: "Bright Path Tutors",
      overview: "Small-group tutoring centre in Bodija, Ibadan",
      targetAudience: "Parents of SS3 students preparing for WAEC",
      tone: "Encouraging, clear, serious about results",
      offer: "Maths, English and science tutoring in small groups",
      values: "Every student understands the method, not just the answer",
      differentiators:
        "Taught by teachers who mark WAEC scripts; past-paper practice under exam conditions every session",
      primaryGoal: "Fill every seat before the January term",
      primaryColor: "#1E3A5F",
      secondaryColor: "#FFF7E0",
    },
    hasLogo: true,
    imageSource: "ko",
    request: {
      title: "WAEC maths crash course",
      designType: "Instagram carousel",
      platform: "Instagram",
      aspectRatio: "4:5",
      briefText:
        "WAEC maths crash course for SS3 students. Six Saturdays from 10 January, 9am to 12pm, at 4 Awolowo Avenue, Bodija. ₦40,000 for the full course. 15 seats. Register at brightpath.ng.",
    },
    offering: "WAEC maths crash course",
    facts: [
      { kind: "date", text: "10 January" },
      { kind: "time", text: "9am to 12pm" },
      { kind: "place", text: "4 Awolowo Avenue, Bodija" },
      { kind: "price", text: "₦40,000 for the full course" },
      { kind: "quantity", text: "15 seats" },
      { kind: "contact", text: "brightpath.ng" },
    ],
  },
  {
    id: "cowork-deck",
    kind: "presentation",
    brand: {
      name: "Udi Hills Cowork",
      overview: "Coworking space in Independence Layout, Enugu",
      targetAudience: "Founders and team leads of small Enugu companies",
      tone: "Confident, plain, warm",
      offer: "Dedicated desks, private offices and meeting rooms",
      values: "Small teams deserve a proper office without a long lease",
      differentiators:
        "Fibre internet with a backup line, and solar power so work never stops for an outage",
      primaryGoal: "Sign five-person teams to monthly team plans",
      primaryColor: "#2B2D42",
      secondaryColor: "#EDF2F4",
    },
    hasLogo: true,
    imageSource: "none",
    request: {
      title: "Team plans at Udi Hills Cowork",
      designType: "Membership presentation",
      platform: "Email to founders",
      aspectRatio: "16:9",
      briefText:
        "Membership deck for teams at Udi Hills Cowork, Enugu. 80 desks, fibre internet and backup power. Team plan ₦450,000 a month for 5 desks. Book a tour: hello@udihillscowork.ng.",
    },
    offering: "Udi Hills Cowork",
    facts: [
      { kind: "place", text: "Enugu" },
      { kind: "quantity", text: "80 desks" },
      { kind: "price", text: "₦450,000 a month" },
      { kind: "quantity", text: "5 desks" },
      { kind: "contact", text: "hello@udihillscowork.ng" },
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
