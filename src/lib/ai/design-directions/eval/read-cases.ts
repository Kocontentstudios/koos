import type { LabelledFact, LabelledOffering } from "./read-score";

/**
 * Briefs labelled by hand for the brief reader: the hard facts a design
 * must carry, what the brief offers, and the real people it names. Labels
 * are the brief's own words. Most are the shapes the hand parsers broke on
 * in rounds 3 and 4 (critic repros); the directions cases carry their own
 * labels (cases.ts) and are scored the same way.
 */

export interface ReadEvalCase {
  id: string;
  briefText: string;
  title: string;
  /** The brand's country, as brandRegion would read it. */
  region: "NG" | "US" | "GH";
  facts: LabelledFact[];
  offering: LabelledOffering;
  people: string[];
}

export const READ_EVAL_CASES: ReadEvalCase[] = [
  /* Round-4 live critic: the address was read as "9 Bourdillon Road,
     Thursday" and printed beside the real one; "only 15 made" was lost. */
  {
    id: "fashion-address-then-days",
    title: "Jade overcoat drop",
    region: "NG",
    briefText:
      "New: our jade organza overcoat with a gold silk tassel. One size, ₦78,000, only 15 made. Try it on at our Ikoyi studio, 9 Bourdillon Road, Thursday to Sunday, 12pm to 6pm.",
    facts: [
      { text: "One size", optional: true },
      { text: "₦78,000" },
      { text: "only 15 made" },
      { text: "Ikoyi studio" },
      { text: "9 Bourdillon Road" },
      { text: "Thursday to Sunday" },
      { text: "12pm to 6pm" },
    ],
    offering: {
      kind: "product",
      phrases: [
        "jade organza overcoat",
        "organza overcoat",
        "jade organza overcoat with a gold silk tassel",
      ],
    },
    people: [],
  },
  /* Round-4 live critic: ₦34,000 lost "for a set of four" and read as the
     price of a cup. */
  {
    id: "cafe-set-of-four",
    title: "Stoneware cups",
    region: "NG",
    briefText:
      "Handmade stoneware cups now on sale at the bar: ₦9,500 each, or NGN 34,000 for a set of four. Open daily 8am to 8pm at 4 Sabo Road, Yaba. Ask the barista to wrap yours.",
    facts: [
      { text: "₦9,500 each" },
      { text: "NGN 34,000 for a set of four" },
      { text: "daily" },
      { text: "8am to 8pm" },
      { text: "4 Sabo Road, Yaba" },
      { text: "Ask the barista to wrap yours", optional: true },
    ],
    offering: {
      kind: "product",
      phrases: ["stoneware cups", "handmade stoneware cups"],
    },
    people: [],
  },
  {
    id: "teen-sourdough-class",
    title: "Teen sourdough class",
    region: "NG",
    briefText:
      "Teen sourdough baking class on Saturday 15 November, 10am to 1pm, at our Lekki shop, 7 Admiralty Way. ₦18,000 per teen, ages 13 to 17. Apron and starter to take home. Only 12 places. Call 0907 222 3190 to book. Led by baker Funke Adeyemi.",
    facts: [
      { text: "Saturday 15 November" },
      { text: "10am to 1pm" },
      { text: "Lekki shop" },
      { text: "7 Admiralty Way" },
      { text: "₦18,000 per teen" },
      { text: "ages 13 to 17" },
      { text: "Apron and starter to take home" },
      { text: "Only 12 places" },
      { text: "Call 0907 222 3190" },
    ],
    offering: {
      kind: "event",
      phrases: [
        "teen sourdough baking class",
        "sourdough baking class",
        "sourdough class",
      ],
    },
    people: ["Funke Adeyemi"],
  },
  /* Round-4 code critic J2: the number before a bare hour range vanished. */
  {
    id: "phone-then-bare-hours",
    title: "Almond croissants",
    region: "NG",
    briefText:
      "Almond croissants are back. WhatsApp 0803 555 0142 9-5 daily to order.",
    facts: [
      { text: "WhatsApp 0803 555 0142" },
      { text: "9-5" },
      { text: "daily" },
    ],
    offering: { kind: "product", phrases: ["almond croissants"] },
    people: [],
  },
  /* J3: "08035550142, 9" glued. */
  {
    id: "phone-comma-hours",
    title: "Zobo by the litre",
    region: "NG",
    briefText:
      "Chilled zobo by the litre, ₦3,000. Call 08035550142, 9-5 weekdays.",
    facts: [
      { text: "₦3,000" },
      { text: "by the litre", optional: true },
      { text: "Call 08035550142" },
      { text: "9-5" },
      { text: "weekdays" },
    ],
    offering: { kind: "product", phrases: ["zobo", "chilled zobo"] },
    people: [],
  },
  /* J5: the second number of a list was lost. */
  {
    id: "two-numbers",
    title: "Party catering",
    region: "NG",
    briefText:
      "Party catering for 20 guests or more. Call 0803 555 0142, 0805 555 0199 for a quote.",
    facts: [
      { text: "20 guests or more" },
      { text: "0803 555 0142" },
      { text: "0805 555 0199" },
    ],
    offering: {
      kind: "service",
      phrases: ["party catering", "catering"],
    },
    people: [],
  },
  /* J4: the handle was read as a website. */
  {
    id: "handle-not-url",
    title: "Birthday cakes",
    region: "NG",
    briefText:
      "Custom birthday cakes from ₦45,000. DM @cake.ng on Instagram with your date, at least 5 days ahead.",
    facts: [
      { text: "from ₦45,000" },
      { text: "@cake.ng" },
      { text: "at least 5 days ahead" },
    ],
    offering: {
      kind: "product",
      phrases: ["custom birthday cakes", "birthday cakes"],
    },
    people: [],
  },
  /* Round-3 code critic: "08035550142 7" was drawn. */
  {
    id: "call-then-hours",
    title: "Office lunch trays",
    region: "NG",
    briefText:
      "Jollof trays for office lunches, ₦12,000 a tray. Call 08035550142 7am to 7pm.",
    facts: [
      { text: "₦12,000 a tray" },
      { text: "Call 08035550142" },
      { text: "7am to 7pm" },
    ],
    offering: {
      kind: "product",
      phrases: ["jollof trays", "jollof trays for office lunches"],
    },
    people: [],
  },
  /* Round-4 code critic: "Shop 12, Palms Mall" lost its prefix. */
  {
    id: "shop-prefix-two-prices",
    title: "Ankara totes",
    region: "NG",
    briefText:
      "Ankara tote bags: ₦8,500 small, ₦12,500 large. Pick yours up at Shop 12, Palms Mall, Lekki, Monday to Saturday.",
    facts: [
      { text: "₦8,500 small" },
      { text: "₦12,500 large" },
      { text: "Shop 12, Palms Mall, Lekki" },
      { text: "Monday to Saturday" },
    ],
    offering: {
      kind: "product",
      phrases: ["ankara tote bags", "tote bags"],
    },
    people: [],
  },
  /* "Plot 5, Admiralty Way, Lekki Phase 1" was drawn without "Plot" and
     "1"; "11-2pm" as "2pm". */
  {
    id: "plot-address-range",
    title: "Second branch opening",
    region: "NG",
    briefText:
      "Grand opening of our second branch at Plot 5, Admiralty Way, Lekki Phase 1 on 1 December, 11-2pm. Free small chops for the first 50 guests.",
    facts: [
      { text: "Plot 5, Admiralty Way, Lekki Phase 1" },
      { text: "1 December" },
      { text: "11-2pm" },
      { text: "Free small chops" },
      { text: "first 50 guests" },
    ],
    offering: {
      kind: "event",
      phrases: [
        "grand opening",
        "grand opening of our second branch",
        "second branch",
      ],
    },
    people: [],
  },
  /* Round-4 code critic: a US number before a bare range was lost. */
  {
    id: "us-number",
    title: "Brooklyn pop-up",
    region: "US",
    briefText:
      "Brooklyn pop-up this Saturday, 10am to 4pm, 214 Wythe Ave. Text (212) 456-7890 for wholesale.",
    facts: [
      { text: "this Saturday" },
      { text: "10am to 4pm" },
      { text: "214 Wythe Ave" },
      { text: "Text (212) 456-7890" },
    ],
    offering: { kind: "event", phrases: ["Brooklyn pop-up", "pop-up"] },
    people: [],
  },
  /* Round-3 and round-4 critics: a painted woman stood in for "Ada Obi". */
  {
    id: "panel-named-speaker",
    title: "Panel announcement",
    region: "NG",
    briefText:
      "Announce our panel 'Building for Heat' with architect Ada Obi, Friday 14 March at 4pm, Landmark Centre. Free registration, limited seats.",
    facts: [
      { text: "Friday 14 March" },
      { text: "4pm" },
      { text: "Landmark Centre" },
      { text: "Free registration" },
      { text: "limited seats", optional: true },
    ],
    offering: {
      kind: "event",
      phrases: [
        "panel 'Building for Heat'",
        "Building for Heat",
        "panel",
        "panel Building for Heat",
      ],
    },
    people: ["Ada Obi"],
  },
  {
    id: "greeting-nothing",
    title: "Eid greeting",
    region: "NG",
    briefText:
      "Eid Mubarak greeting to our customers and their families. No promotion, just warm wishes.",
    facts: [],
    offering: { kind: "none", phrases: [] },
    people: [],
  },
  /* Round-4 code critic J9: "Iced coffee" grew to the plate product
     "ice". */
  {
    id: "renamed-cold-brew",
    title: "Cold brew launch",
    region: "NG",
    briefText:
      "Launch our new cold brew. Served over ice, ₦2,500 a bottle, from Friday at both Yaba and Surulere bars.",
    facts: [
      { text: "₦2,500 a bottle" },
      { text: "from Friday" },
      { text: "Yaba and Surulere bars" },
    ],
    offering: { kind: "product", phrases: ["cold brew"] },
    people: [],
  },
];
