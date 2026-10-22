import { describe, expect, it } from "vitest";
import {
  briefSpanFor,
  type DrawnCopy,
  documentParts,
  factLedger,
  inventedFacts,
  looksCutOff,
  productFromBrief,
  type ReasonContext,
  reasonHolds,
  resolveBriefProducts,
  spatialClaim,
} from "./claims";

const BAKERY_BRIEF =
  "Launch our new strawberry mille-feuille, ₦4,500 a slice, available from Monday. Commuters can order ahead for pickup from 7am.";
const TEXTILE_BRIEF =
  "Announce the autumn aso-oke collection, launching 3 November. Twelve new throws and cushions in rust and indigo, each woven by one artisan in Iseyin.";

const bakery = factLedger([
  BAKERY_BRIEF,
  "Neighbourhood French bakery in Lekki, Lagos.",
]);
const textile = factLedger([TEXTILE_BRIEF]);

describe("inventedFacts", () => {
  /* Round-1 live run, variant a: the headline the critic flagged. */
  it("catches a duration the brief never gave", () => {
    expect(
      inventedFacts("Seven layers. Seven minutes from your door.", bakery),
    ).toEqual(["Seven layer", "Seven minute"]);
  });

  /* Round-1 builder run: "12 Artisans" from a brief about twelve throws. */
  it("catches a count that borrows a number from something else", () => {
    expect(inventedFacts("12 Artisans", textile)).toEqual(["12 artisan"]);
    expect(inventedFacts("Twelve artisans, one loom", textile)).toEqual([
      "Twelve artisan",
    ]);
  });

  it("accepts the brief's own count, price, time and day in any spelling", () => {
    expect(inventedFacts("12 new throws and cushions", textile)).toEqual([]);
    expect(inventedFacts("Twelve handwoven throws", textile)).toEqual([]);
    expect(inventedFacts("₦4,500 a slice from Monday", bakery)).toEqual([]);
    expect(inventedFacts("N4,500. Ready at 7am", bakery)).toEqual([]);
    expect(inventedFacts("₦4.5k, pick up 7 AM", bakery)).toEqual([]);
    expect(inventedFacts("Out 3 November", textile)).toEqual([]);
  });

  it("catches a price, time, day or month that is not in the brief", () => {
    expect(inventedFacts("₦3,900 this week", bakery)).toEqual([
      "₦3,900",
      "this week",
    ]);
    expect(inventedFacts("Ready by 6:30am", bakery)).toContain("6:30");
    expect(inventedFacts("Every Friday", bakery)).toEqual(["friday"]);
    expect(inventedFacts("Launching in December", textile)).toEqual(["dec"]);
  });

  it("catches a customer-facing claim the brand never made", () => {
    expect(inventedFacts("Free delivery across Lekki", bakery)).toEqual([
      "Free",
      "delivery",
    ]);
    expect(inventedFacts("Award-winning pastry", bakery)).toEqual(["Award"]);
    expect(
      inventedFacts("Free registration", factLedger(["Free registration"])),
    ).toEqual([]);
  });

  it("accepts a claim the brief makes in other words", () => {
    const fintech = factLedger([
      "Send money to 20 African countries with zero transfer fees for your first month.",
    ]);
    expect(inventedFacts("Send money free for a month", fintech)).toEqual([]);
    expect(
      inventedFacts(
        "Handmade in Iseyin",
        factLedger(["Handwoven aso-oke textiles"]),
      ),
    ).toEqual([]);
  });

  it("does not read a number that ends its phrase as a count", () => {
    const box = factLedger([
      "Valentine's dessert box for two: six pastries and a handwritten card.",
    ]);
    expect(inventedFacts("Made for two. Order by Friday", box)).toEqual([
      "friday",
    ]);
    expect(inventedFacts("Two hearts, one box", box)).toEqual(["Two heart"]);
  });

  it("leaves placeholders and plain copy alone", () => {
    expect(inventedFacts("Call [PHONE NUMBER]", bakery)).toEqual([]);
    expect(inventedFacts("Order ahead for pickup", bakery)).toEqual([]);
    expect(inventedFacts("One slice, all the layers", bakery)).toEqual([]);
  });
});

describe("spatialClaim", () => {
  it.each([
    "Product fills two-thirds of the frame",
    "The mille-feuille dominates the left",
    "Pastry glows against the dark ground",
    "Price sits beside the button",
    "Headline set large across the top",
    "Takes up 60% of the canvas",
    "The 7am typographic accent stays legible at thumbnail size",
    "The green button echoes the brand accent",
    "The headline puts ₦4,500 upfront",
    "The 7am pickup is prominent in the footer",
    "The subheadline gives the price in one readable line",
  ])("flags %s", (reason) => {
    expect(spatialClaim(reason)).not.toBeNull();
  });

  it.each([
    "Headline names the strawberry mille-feuille",
    "Leads with the ₦4,500 price commuters ask about",
    "The 7am pickup answers the commuter's first question",
  ])("passes %s", (reason) => {
    expect(spatialClaim(reason)).toBeNull();
  });

  /* Round-2 eval false positives: a venue called "Landmark Centre", and a
     reason that says which line of copy holds a fact. */
  it("allows a place name and a statement of which copy holds a fact", () => {
    expect(
      spatialClaim(
        "Friday 14 March at Landmark Centre is in the footer",
        "Friday 14 March at 4pm, Landmark Centre",
      ),
    ).toBeNull();
    expect(
      spatialClaim("The 30 November deadline sits in the footer"),
    ).toBeNull();
    expect(spatialClaim("The price sits beside the button")).toBe("beside");
    expect(spatialClaim("The image is the visual anchor")).toBe("anchor");
  });

  it("allows a colour the brief names", () => {
    expect(
      spatialClaim(
        "Rust and indigo are named in the subheadline",
        "Twelve new throws and cushions in rust and indigo",
      ),
    ).toBeNull();
  });

  it("allows a word the brief itself uses", () => {
    expect(
      spatialClaim("Names the top floor venue", "Panel on the top floor"),
    ).toBeNull();
  });
});

describe("looksCutOff", () => {
  /* Round-1 cards: "…matches the warm", "…a distinct…", "so no fact from
     the brief goes". */
  it.each([
    "Each scene gives a distinct…",
    "Copy stays short so no fact from the brief and",
    "Names the price,",
    'Quotes "fresh',
  ])("flags %s", (text) => {
    expect(looksCutOff(text)).toBe(true);
  });

  it("passes a finished sentence", () => {
    expect(looksCutOff("Names the price commuters ask about first")).toBe(
      false,
    );
  });
});

describe("reasonHolds", () => {
  const copy: DrawnCopy = {
    headline: "Strawberry mille-feuille is here",
    subheadline: "₦4,500 a slice from Monday",
    cta: "Order for 7am pickup",
    footerLines: [],
  };
  const ctx = (over: Partial<ReasonContext> = {}): ReasonContext => ({
    copy,
    ledger: bakery,
    briefText: BAKERY_BRIEF,
    product: "strawberry mille-feuille",
    image: "verified",
    ...over,
  });

  it("accepts a reason the design bears out", () => {
    expect(
      reasonHolds("Headline names the strawberry mille-feuille", ctx()),
    ).toEqual({ ok: true });
    expect(
      reasonHolds("The subheadline gives the ₦4,500 price and Monday", ctx()),
    ).toEqual({ ok: true });
    expect(
      reasonHolds('The button says "order for 7am pickup"', ctx()),
    ).toEqual({ ok: true });
  });

  /* Round-1 live run, variant b: "price and day together in the
     subheadline" on a design whose subheadline held neither. */
  it("refuses an element claim the spec does not hold", () => {
    const plain = ctx({
      copy: { ...copy, subheadline: "Layers of cream and fruit" },
    });
    expect(
      reasonHolds("Price and the day together in the subheadline", plain).ok,
    ).toBe(false);
    expect(reasonHolds("The headline carries the price", ctx()).ok).toBe(false);
  });

  it("refuses a price or time the design never shows", () => {
    const bare = ctx({
      copy: { headline: "Layer on layer", footerLines: [] },
    });
    expect(
      reasonHolds("Leads with the price commuters ask about", bare).ok,
    ).toBe(false);
    expect(reasonHolds("Gives the pickup time up top", bare).ok).toBe(false);
  });

  it("refuses spatial claims and invented facts", () => {
    expect(reasonHolds("Product fills two-thirds of the frame", ctx()).ok).toBe(
      false,
    );
    expect(reasonHolds("Seven minutes from every commuter", ctx()).ok).toBe(
      false,
    );
  });

  it("refuses an image claim when nobody checked the image", () => {
    const reason = "The photo shows the strawberry mille-feuille itself";
    expect(reasonHolds(reason, ctx({ image: "verified" })).ok).toBe(true);
    expect(reasonHolds(reason, ctx({ image: "seen" })).ok).toBe(true);
    expect(reasonHolds(reason, ctx({ image: "unverified" })).ok).toBe(false);
    expect(reasonHolds(reason, ctx({ image: "none" })).ok).toBe(false);
  });

  /* Round-2 eval: "The takeaway cup signals an on-the-go occasion" on a
     plate checked only for the pastry. */
  it("refuses a KO reason about a prop the plate check never looked for", () => {
    const scene =
      "A strawberry mille-feuille next to a takeaway coffee cup on a desk at dawn";
    expect(
      reasonHolds(
        "The takeaway cup signals an on-the-go occasion",
        ctx({ paintedScene: scene }),
      ).ok,
    ).toBe(false);
    expect(
      reasonHolds(
        "The image shows the strawberry mille-feuille itself",
        ctx({ paintedScene: scene }),
      ).ok,
    ).toBe(true);
    expect(
      reasonHolds(
        "Headline names the strawberry mille-feuille",
        ctx({ paintedScene: scene }),
      ).ok,
    ).toBe(true);
  });

  it("refuses a reason about a button the design does not have", () => {
    const noCta = ctx({ copy: { ...copy, cta: undefined } });
    expect(reasonHolds("The button asks for one thing", noCta).ok).toBe(false);
  });
});

describe("productFromBrief", () => {
  it("keeps a product the brief names", () => {
    expect(productFromBrief("Strawberry mille-feuille", BAKERY_BRIEF)).toBe(
      "Strawberry mille-feuille",
    );
  });

  it("drops one the model made up", () => {
    expect(productFromBrief("Strawberry tart", BAKERY_BRIEF)).toBe("");
    expect(productFromBrief("", BAKERY_BRIEF)).toBe("");
  });
});

/* The round-2 code critic's probes (u3-r2-code/claims-probe.log): every one
   of these reached a delivered design. Each is checked against the bakery
   brief, which states a price, a day and a time and none of these. */
describe("inventedFacts, round-2 probes", () => {
  const caught: [string, string][] = [
    ["Open Sat & Sun", "saturday"],
    ["Fri only", "friday"],
    ["Tonight only", "tonight"],
    ["Today only", "today"],
    ["Tomorrow only", "tomorrow"],
    ["This Christmas, treat yourself", "christmas"],
    ["Valentine's special", "valentine"],
    ["Ready for Eid", "eid"],
    ["Lagos's number one bakery", "number one"],
    ["The #1 pastry in Lekki", "#1"],
    ["Buy one, get one", "Buy one, get one"],
    ["Half price this week", "Half price"],
    ["Ships today", "Ships"],
    ["Launching in May", "may"],
    ["Top-rated in Lekki", "Top-rated"],
    ["Back by popular demand", "by popular demand"],
    ["Sold out last time", "Sold out"],
    ["Only a few left", "Only"],
    ["Saturday only", "saturday"],
    ["This weekend only", "weekend"],
    ["Freshly baked daily", "Freshly"],
    ["Lekki's best croissant", "best"],
  ];
  for (const [copy, word] of caught) {
    it(`catches "${copy}"`, () => {
      const found = inventedFacts(copy, bakery).map((w) => w.toLowerCase());
      expect(found).toContain(word.toLowerCase());
    });
  }

  /* Round-2 live run: the facts were the brief's, the words in front of
     them were not. */
  it("catches a price or time whose qualifier the brief never used", () => {
    expect(inventedFacts("From ₦4,500 a slice", bakery)).toContain(
      "from ₦4,500",
    );
    expect(inventedFacts("Fresh before 7am", bakery)).toContain("before 7am");
    expect(inventedFacts("Just ₦4,500", bakery)).toContain("just ₦4,500");
    expect(inventedFacts("Pickup from 7am", bakery)).toEqual([]);
  });

  it("catches a now-claim the brief never made", () => {
    const zobo = factLedger([
      "New this weekend: chilled zobo hibiscus cooler, ₦1,800 for a 500ml bottle.",
    ]);
    expect(inventedFacts("Now in a bottle", zobo)).toContain("Now in");
    expect(inventedFacts("Now available", zobo)).toEqual([]);
    expect(inventedFacts("This weekend only", zobo)).toEqual(["only"]);
  });

  it("accepts a range restated with the brief's ends", () => {
    const workshop = factLedger([
      "Kids' croissant workshop this Saturday, 10am to 12pm at our Lekki shop.",
    ]);
    expect(inventedFacts("Sat 10am–12pm", workshop)).toEqual([]);
    expect(inventedFacts("From 10am until 12pm", workshop)).toEqual([]);
    expect(inventedFacts("Before 12pm", workshop)).toEqual(["before 12pm"]);
  });

  it("leaves the sun, the verb may and the brief's own claims alone", () => {
    expect(inventedFacts("Pastry under the Sun", bakery)).toEqual([]);
    expect(inventedFacts("You may want another", bakery)).toEqual([]);
    expect(
      inventedFacts(
        "Only 8 spots",
        factLedger(["Ages 7 to 12, only 8 spots."]),
      ),
    ).toEqual([]);
  });
});

describe("spatialClaim, round-2 probes", () => {
  /* u3-r2-code/spatial-probe.log: all five came back null. */
  for (const reason of [
    "Soft morning light makes the pastry look fresh",
    "Moody lighting adds drama",
    "Deep burgundy tones feel premium",
    "Lowercase serif type feels refined",
    "Bold headline stops the scroll",
    "Warm hues make it inviting",
    "Italic script feels handmade",
    "Shadows give it depth",
  ]) {
    it(`flags "${reason}"`, () => {
      expect(spatialClaim(reason, BAKERY_BRIEF)).not.toBeNull();
    });
  }

  it("does not read quoted copy as a claim about the type", () => {
    expect(spatialClaim('The headline reads "Bold mornings"', "")).toBeNull();
  });
});

describe("reasonHolds, parts and pictures", () => {
  const copy: DrawnCopy = {
    headline: "Little bakers wanted",
    subheadline: "Croissants from scratch, ₦15,000",
    cta: "Only 8 spots",
    footerLines: [],
  };
  const workshop = factLedger([
    "Kids' croissant workshop, ₦15,000 per child, only 8 spots.",
  ]);
  const ctx = (over: Partial<ReasonContext> = {}): ReasonContext => ({
    copy,
    ledger: workshop,
    briefText: "",
    product: "",
    image: "seen",
    ...over,
  });

  /* Round-2 live run: no layout draws a tag; the button was meant. */
  it("refuses a tag, badge or sticker no layout draws", () => {
    expect(
      reasonHolds("The accent tag calls out the 8-spot limit", ctx()).ok,
    ).toBe(false);
    expect(reasonHolds("A badge carries the price", ctx()).ok).toBe(false);
  });

  it("checks a logo or accent rule against the drawn document", () => {
    const drawn = documentParts([
      { type: "text", id: "headline" },
      { type: "shape", id: "accent-rule" },
    ]);
    expect(
      reasonHolds("The brand logo signs off the post", ctx({ elements: drawn }))
        .ok,
    ).toBe(false);
    expect(
      reasonHolds(
        "The accent rule ties the copy together",
        ctx({ elements: drawn }),
      ).ok,
    ).toBe(true);
  });

  /* Round-2 live run, zobo: the plate showed a bottle and no pastry. */
  it("refuses an image claim the look at the image does not bear out", () => {
    const zobo = factLedger([
      "Chilled zobo hibiscus cooler, ₦1,800. Grab one with any pastry before noon.",
    ]);
    const look = ctx({
      ledger: zobo,
      product: "zobo hibiscus cooler",
      image: "verified",
      imageDescription:
        "a glass bottle of zobo hibiscus cooler, ice, hibiscus flowers",
    });
    expect(reasonHolds("Pastry is shown with the cooler", look)).toMatchObject({
      ok: false,
    });
    expect(
      reasonHolds("The photo shows the zobo hibiscus cooler with ice", look).ok,
    ).toBe(true);
  });
});

describe("product resolution, round-2 probes", () => {
  it("accepts the brief's product however the model spells it", () => {
    expect(productFromBrief("strawberry millefeuille", BAKERY_BRIEF)).toBe(
      "strawberry millefeuille",
    );
  });

  it("falls back to the brief's own words for the part it names", () => {
    expect(briefSpanFor("Strawberry Napoleon", BAKERY_BRIEF)).toBe(
      "strawberry",
    );
    expect(briefSpanFor("strawberry millefeuille", BAKERY_BRIEF)).toBe(
      "strawberry mille-feuille",
    );
  });

  /* Round-2 code critic: "Strawberry Napoleon" or an empty name skipped the
     plate check while the brief named a product. */
  it("checks every plate for the brief's product when one direction names it", () => {
    expect(
      resolveBriefProducts(
        ["Strawberry Napoleon", "mille-feuille"],
        BAKERY_BRIEF,
      ),
    ).toEqual([
      { name: "mille-feuille", from: "sibling" },
      { name: "mille-feuille", from: "model" },
    ]);
    expect(resolveBriefProducts(["", ""], BAKERY_BRIEF)).toEqual([
      { name: "", from: "none" },
      { name: "", from: "none" },
    ]);
  });
});
