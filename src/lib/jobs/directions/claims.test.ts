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
      "one loom",
    ]);
  });

  /* Round-12 code critic: the tokenizer and inventedFacts read number
     words two ways ("one" here, "five hundred" as 5 and 100). */
  it("reads number words as the verifier's tokenizer does", () => {
    const venue = factLedger(["Room for five hundred guests and one stage."]);
    expect(inventedFacts("Five hundred guests", venue)).toEqual([]);
    expect(inventedFacts("Five hundred stalls", venue)).toEqual([
      "Five hundred stall",
    ]);
    expect(inventedFacts("Twenty-one guests", venue)).toEqual(["Twenty-one"]);
    expect(inventedFacts("The one guest we wait for", venue)).toEqual([]);
  });

  it("accepts the brief's own count, price, time and day in any spelling", () => {
    expect(inventedFacts("12 new throws and cushions", textile)).toEqual([]);
    /* Round 6: "woven by one artisan" does not say by hand. */
    expect(inventedFacts("Twelve handwoven throws", textile)).toEqual([
      "handwoven",
    ]);
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
    /* Round 7: a method claim is licensed only by itself, "Handwoven"
       does not say "Handmade" (round-6 code critic, C2). */
    expect(
      inventedFacts(
        "Handwoven in Iseyin",
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

  /* Round-4 code critic, break 5: four reasons accepted though false. */
  it("refuses the round-4 critic's false reasons", () => {
    const sold: DrawnCopy = {
      headline: "Strawberry mille-feuille is here",
      cta: "Order on WhatsApp",
      footerLines: ["₦4,500 a slice · Saturday 7am"],
    };
    const on = (over: Partial<ReasonContext> = {}) =>
      ctx({ copy: sold, ...over });
    expect(reasonHolds("The button carries the WhatsApp number", on()).ok).toBe(
      false,
    );
    expect(
      reasonHolds("Every fact a buyer needs is on the design", on()).ok,
    ).toBe(false);
    expect(
      reasonHolds(
        "Every fact a buyer needs is on the design",
        on({ factsMissing: 1 }),
      ).ok,
    ).toBe(false);
    expect(
      reasonHolds(
        "Every fact a buyer needs is on the design",
        on({ factsMissing: 0 }),
      ).ok,
    ).toBe(true);
    expect(
      reasonHolds(
        "The footer gives the price so no fact from the brief is missing",
        on({ factsMissing: 2 }),
      ).ok,
    ).toBe(false);
    expect(
      reasonHolds("Shows the cream between the layers", on({ image: "none" }))
        .ok,
    ).toBe(false);
    expect(reasonHolds("Eye goes from headline to button", on()).ok).toBe(
      false,
    );
  });

  it("accepts a number reason when the button carries the number", () => {
    expect(
      reasonHolds(
        "The button gives the WhatsApp number",
        ctx({
          copy: {
            headline: "Strawberry mille-feuille",
            cta: "WhatsApp 0803 555 0142",
            footerLines: [],
          },
          ledger: factLedger([`${BAKERY_BRIEF} WhatsApp 0803 555 0142.`]),
        }),
      ).ok,
    ).toBe(true);
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
    /* Round-3 code critic: "strawberry" alone checked the plate for a
       strawberry. The brief's whole phrase is the product. */
    expect(briefSpanFor("Strawberry Napoleon", BAKERY_BRIEF)).toBe(
      "strawberry mille-feuille",
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
      { name: "strawberry mille-feuille", from: "sibling" },
      { name: "strawberry mille-feuille", from: "model" },
    ]);
    /* Round-3 code critic P4a: with no name from the model the plate was
       checked for nothing and recorded "passed". */
    expect(resolveBriefProducts(["", ""], BAKERY_BRIEF)).toEqual([
      { name: "strawberry mille-feuille", from: "brief" },
      { name: "strawberry mille-feuille", from: "brief" },
    ]);
    expect(resolveBriefProducts(["", ""], "Happy new month!")).toEqual([
      { name: "", from: "none" },
      { name: "", from: "none" },
    ]);
  });

  /* Round-4 code critic J9 and J10, for when the brief reader is not
     reachable: one word the model's name shared grew into "ice" and
     "strawberry cream". */
  it("prefers the product the brief introduces over a phrase grown from one shared word", () => {
    expect(
      resolveBriefProducts(
        ["Iced coffee", "Iced coffee"],
        "Launch our new cold brew. Served over ice",
      )[0],
    ).toEqual({ name: "cold brew", from: "brief" });
    expect(
      resolveBriefProducts(
        ["Strawberry Napoleon", ""],
        "Launch our new mille-feuille with fresh strawberry cream",
      )[0],
    ).toEqual({ name: "mille-feuille", from: "brief" });
  });
});

/* Round-3 code critic, break 10: every row of its probe, each drawable as
   it was. The detectors read English; copy in another language is the
   claim check's (claim-check.ts). */
describe("inventedFacts, round 4", () => {
  const LEKKI_BRIEF =
    "Launch our new strawberry mille-feuille, ₦4,500 a slice. Pickup from 7am at our Lekki shop. Order on WhatsApp 0803 555 0142.";
  const ledger = factLedger([
    LEKKI_BRIEF,
    "Strawberry mille-feuille launch",
    "Petit Four Bakery",
    "A small bakery in Lekki, Lagos",
  ]);

  it.each([
    ["Open Saturdays and Sundays"],
    ["SAT & SUN"],
    ["sat & sun pickup"],
    ["Grab yours tonite"],
    ["Ready this evening"],
    ["Orders close at midnight"],
    ["Ready by noon"],
    ["On the counter all week"],
    ["Until the end of the month"],
    ["This festive season"],
    ["$4,500 a slice"],
    ["₦4,500+ a slice"],
    ["₦4,500 and up"],
    ["Slices ₦4,500 upwards"],
    ["Min. ₦4,500 order"],
    ["Mega sale on mille-feuille"],
    ["Discounted slices this launch"],
    ["Launch promo price"],
    ["Deal of the day"],
    ["Complimentary cream on every slice"],
    ["Cream is on the house"],
    ["Straight to your doorstep"],
    ["Same-hour dispatch"],
    ["Lagos's finest mille-feuille"],
    ["The tastiest slice in Lekki"],
    ["Lekki's favourite slice"],
    ["Unbeatable layers"],
    ["Cheapest in town"],
    ["World-class pastry"],
    ["First in Lagos to bake it"],
    ["The original mille-feuille"],
    ["Loved by thousands"],
    ["Dozens sold every morning"],
    ["Hundreds of happy customers"],
    ["Double the cream"],
    ["Twice the layers"],
    ["Triple-layered"],
    ["Satisfaction promised or your money back"],
    ["Full refund if not happy"],
    ["Prize-winning pastry"],
    ["Handcrafted every morning"],
    ["Still warm at 7am"],
    ["Gone by morning"],
  ])("catches %s", (copy) => {
    expect(inventedFacts(copy, ledger)).not.toEqual([]);
  });

  it("keeps the brief's own price, time and place", () => {
    expect(inventedFacts("₦4,500 a slice, pickup from 7am", ledger)).toEqual(
      [],
    );
    expect(inventedFacts("Your Lekki slice is ready", ledger)).toEqual([]);
  });

  it("reads the brand's voice as voice, not fact", () => {
    const voiced = factLedger([LEKKI_BRIEF]);
    expect(inventedFacts("Still warm at 7am", voiced)).toEqual(["warm"]);
  });
});

describe("reasonHolds, round 4", () => {
  const ledger = factLedger([
    "Launch our new strawberry mille-feuille, ₦4,500 a slice. Pickup from 7am at our Lekki shop. Order on WhatsApp 0803 555 0142.",
    "A small bakery in Lekki, Lagos",
  ]);
  const ctx = (copy: Partial<DrawnCopy> = {}): ReasonContext => ({
    copy: {
      headline: "Layers worth the wait",
      subheadline: "Strawberry mille-feuille, fresh cream between crisp pastry",
      cta: "Order now",
      footerLines: ["₦4,500 a slice"],
      ...copy,
    },
    ledger,
    briefText: "",
    product: "strawberry mille-feuille",
    image: "none",
  });

  /* Break 4: each named a piece of copy and a thing it did not carry. */
  it.each([
    "The headline names the croissant straight away",
    "Leads with the croissant, the product commuters queue for",
    "The footer gives the WhatsApp number",
    "The button gives the pickup address",
    "The subheadline names the Lekki shop",
    "The headline speaks to commuters with the 7am pickup time",
  ])("refuses %s", (reason) => {
    expect(reasonHolds(reason, ctx()).ok).toBe(false);
  });

  it("accepts the same claims when the copy carries them", () => {
    expect(
      reasonHolds(
        "The footer gives the WhatsApp number",
        ctx({ footerLines: ["WhatsApp 0803 555 0142"] }),
      ).ok,
    ).toBe(true);
    expect(
      reasonHolds("The subheadline names the strawberry mille-feuille", ctx())
        .ok,
    ).toBe(true);
    expect(
      reasonHolds("The footer states ₦4,500 so the price is clear", ctx()).ok,
    ).toBe(true);
  });

  /* Break 5: type and composition, and a word the brief uses in another
     sense. */
  it.each([
    "Chunky type reads at a glance",
    "Playful type matches the brand",
    "Tight leading keeps it compact",
    "Wide tracking feels premium",
    "Rounded letterforms feel friendly",
    "Clean, uncluttered layout lets the product breathe",
    "Generous spacing feels calm and premium",
    "Symmetry makes it feel balanced",
    "Gradient wash adds depth",
  ])("calls %s a claim it cannot know", (reason) => {
    expect(spatialClaim(reason, ledger.text)).not.toBeNull();
  });

  it("exempts a source word only in the source's own sense", () => {
    expect(
      spatialClaim(
        "Warm evening light makes it feel welcoming",
        "Doors open at 6pm, light refreshments served",
      ),
    ).toBe("light");
    expect(
      spatialClaim(
        "Bright, high-contrast type reads in a scroll",
        "A talk for Bright minds",
      ),
    ).not.toBeNull();
    expect(
      spatialClaim(
        "Rust and indigo echo the collection",
        "Throws in rust and indigo",
      ),
    ).toBeNull();
  });
});

/* Break 6: the plate checked for one modifier word, or for a channel. */
describe("plate product, round 4", () => {
  const brief =
    "Launch our new strawberry mille-feuille. Fresh cream, crisp pastry layers. Order on WhatsApp at our Lekki shop from 7am.";

  it("never shortens the product to one modifier word", () => {
    expect(resolveBriefProducts(["Strawberry Napoleon", ""], brief)).toEqual([
      { name: "strawberry mille-feuille", from: "brief" },
      { name: "strawberry mille-feuille", from: "brief" },
    ]);
  });

  it("never takes a channel, a place, a time or a shop for the product", () => {
    for (const names of [
      ["WhatsApp", "Lekki"],
      ["7am", "shop"],
    ]) {
      expect(resolveBriefProducts(names, brief).map((p) => p.name)).toEqual([
        "strawberry mille-feuille",
        "strawberry mille-feuille",
      ]);
    }
    expect(productFromBrief("WhatsApp", brief)).toBe("");
    expect(productFromBrief("Lekki", brief)).toBe("");
  });
});

describe("reasonHolds, round-4 live run", () => {
  it("refuses a footer reason naming a place the footer does not carry", () => {
    const ledger = factLedger([
      "Launch our new strawberry mille-feuille, ₦4,500 a slice, available from Monday.",
      "Neighbourhood French bakery in Lekki, Lagos.",
    ]);
    const ctx: ReasonContext = {
      copy: {
        headline: "Ready Before You Rush",
        footerLines: ["Available from Monday · Pickup from 7am"],
      },
      ledger,
      briefText: "",
      product: "strawberry mille-feuille",
      image: "none",
    };
    expect(
      reasonHolds(
        "The footer pins Monday availability and the Lekki neighbourhood for locals.",
        ctx,
      ).ok,
    ).toBe(false);
  });
});

/* Round-4 eval, masterclass: an age floor read as a count of milk, and a
   phone number's last group as a count of what followed it. */
describe("inventedFacts on an event footer", () => {
  const ledger = factLedger([
    "Latte art masterclass on Sunday 9 November, 2pm to 5pm. ₦25,000 per person, ages 16 and up, all milk and beans included, 10 seats. Call or WhatsApp 0812 444 7781 to book.",
  ]);
  it.each([
    "10 seats · Ages 16+ · Milk & beans included",
    "Call/WhatsApp 0812 444 7781 · 2pm to 5pm",
    "Call/WhatsApp 0812 444 7781 · Latte art",
    "Sun 9 Nov · 2–5pm · ₦25,000 per person",
  ])("accepts %s", (copy) => {
    expect(inventedFacts(copy, ledger)).toEqual([]);
  });
});

describe("reasonHolds, any verb", () => {
  const ledger = factLedger([
    "Our forest-green silk organza wrap robe is back. Sizes 8 to 18, ₦52,000. Book a fitting at our Ikoyi studio, Tuesday to Saturday, 11am to 7pm.",
  ]);
  const ctx: ReasonContext = {
    copy: {
      headline: "The Silk Wrap Robe Is Back",
      cta: "Book Your Fitting",
      footerLines: ["₦52,000 · Sizes 8 to 18"],
    },
    ledger,
    briefText: "",
    product: "silk organza wrap robe",
    image: "none",
  };

  /* Round-4 live run, fashion: neither button carried the studio. */
  it.each([
    "The CTA points directly to the Ikoyi studio fitting the brief requests.",
    "The CTA drives the Ikoyi fitting appointment the brief asks for.",
  ])("refuses %s", (reason) => {
    expect(reasonHolds(reason, ctx).ok).toBe(false);
  });

  it("leaves a reason about who the copy moves alone", () => {
    expect(
      reasonHolds("The button invites people to book a fitting.", ctx).ok,
    ).toBe(true);
  });
});

describe("reasonHolds, by naming", () => {
  it("holds what a reason says the copy names, after its audience", () => {
    const ctx: ReasonContext = {
      copy: { headline: "Your 7am reward.", footerLines: [] },
      ledger: factLedger(["Commuters can order ahead for pickup from 7am."]),
      briefText: "",
      product: "",
      image: "none",
    };
    expect(
      reasonHolds(
        "The headline speaks to commuters by naming their 7am pickup time.",
        ctx,
      ).ok,
    ).toBe(false);
  });
});

/* Round-4 eval: "month" from "Zero-fee launch month" and "panel 'Building"
   from "Announce our panel 'Building for Heat'" were checked as products. */
describe("a product the brief introduces", () => {
  it.each([
    "Send money with zero transfer fees for your first month. Zero-fee launch month",
    "Announce our panel 'Building for Heat' with architect Ada Obi.",
  ])("is nothing in %s", (brief) => {
    expect(resolveBriefProducts(["", ""], brief)[0].name).toBe("");
  });
});

describe("round-4 eval false positives and misses", () => {
  const ledger = factLedger([
    "Send money to 20 African countries with zero transfer fees for your first month.",
  ]);
  it("reads a promise or delivery as a noun or metaphor, not a claim", () => {
    expect(
      inventedFacts("The headline names the zero-fee promise", ledger),
    ).toEqual([]);
    expect(inventedFacts("The headline delivers the greeting", ledger)).toEqual(
      [],
    );
    expect(
      inventedFacts("We promise free transfers forever", ledger),
    ).toContain("We promise");
  });

  it("catches an all-inclusive price the brief never set", () => {
    const event = factLedger([
      "₦25,000 per person, all milk and beans included.",
    ]);
    expect(inventedFacts("₦25,000 all-inclusive", event)).toContain(
      "all-inclusive",
    );
  });

  it("grows the model's product name to the brief's whole phrase", () => {
    expect(
      resolveBriefProducts(
        ["espresso flight", "espresso flight"],
        "Our new single-origin espresso flight is here: three shots for ₦6,000.",
      )[0].name,
    ).toBe("single-origin espresso flight");
  });
});

/* Round-6 eval, fintech-ko: "The stat treatment puts the one-month duration
   as the dominant read" was delivered; it describes a layout. */
describe("spatialClaim, round 6", () => {
  it("catches a treatment or a dominant read", () => {
    expect(
      spatialClaim(
        "The stat treatment puts the one-month duration as the dominant read.",
      ),
    ).not.toBeNull();
  });
});

/* Round-6 eval, run a: method and origin claims the brief does not make,
   licensed before by the brand profile's own "handwoven". */
describe("method, origin and material are the brief's alone", () => {
  const withProfile = factLedger(
    [TEXTILE_BRIEF, "", "Handwoven aso-oke textiles for modern homes."],
    2,
  );

  it("refuses 'woven by hand' and 'hand-woven' the brief does not state", () => {
    expect(
      inventedFacts("Each one woven by hand in Iseyin", withProfile),
    ).toEqual(["woven by hand"]);
    expect(inventedFacts("Hand-woven in Iseyin", withProfile)).toEqual([
      "Hand-woven",
    ]);
  });

  it("keeps what the brief does say", () => {
    expect(
      inventedFacts("Each woven by one artisan in Iseyin", withProfile),
    ).toEqual([]);
    const handBrief = factLedger(["Our hand-dyed adire, ₦20,000."], 1);
    expect(inventedFacts("Hand-dyed adire", handBrief)).toEqual([]);
  });

  it("refuses an origin or material claim the brief does not make", () => {
    expect(inventedFacts("Locally sourced fibres", withProfile)).toEqual([
      "Locally sourced",
    ]);
    expect(inventedFacts("100% natural cotton", withProfile)).toContain(
      "100% natural",
    );
  });
});

/* Round-6 code critic, r6-claims.log C1 to C7. */
describe("brief-only claims, variant by variant", () => {
  const ledger = (brief: string, profile: string) =>
    factLedger([brief, "", profile], 2);

  it("C1: 'Locally made' does not license 'Imported'", () => {
    expect(
      inventedFacts(
        "Imported silk, ₦12,000",
        ledger("Locally made silk scarves, ₦12,000.", "Lagos scarf label."),
      ),
    ).toEqual(["Imported"]);
  });

  it("C2: 'Hand-dyed' does not license 'Hand-woven'", () => {
    expect(
      inventedFacts(
        "Hand-woven adire throws",
        ledger("Hand-dyed adire throws, ₦30,000.", "Textile studio."),
      ),
    ).toEqual(["Hand-woven"]);
  });

  it("C3 and C4: tone and light are not claims", () => {
    expect(
      inventedFacts(
        "Pure joy in every slice",
        ledger("Chocolate cake, ₦15,000 a box.", "Bakery in Yaba."),
      ),
    ).toEqual([]);
    expect(
      inventedFacts(
        "Portraits in natural light",
        ledger("Portrait sessions Saturday, ₦40,000.", "Photography studio."),
      ),
    ).toEqual([]);
  });

  it("C5: the profile's handmade does not license it", () => {
    expect(
      inventedFacts(
        "Handmade mugs, ₦8,000",
        ledger("Ceramic mugs ₦8,000.", "We handmake ceramics in Ibadan."),
      ),
    ).toEqual(["Handmade"]);
  });

  it("licenses each spelling of the one claim the brief makes", () => {
    const brief = ledger("Each throw woven by hand in Iseyin.", "Textiles.");
    expect(inventedFacts("Hand-woven in Iseyin", brief)).toEqual([]);
    expect(inventedFacts("Handwoven throws", brief)).toEqual([]);
  });
});

/* Round-7 live run, fashion: "fits UK 8 to 14, ₦115,000" read "14," as a
   count of "115" and refused a correct rewrite. */
it("never reads the number after a comma as what a count counts", () => {
  const coat = factLedger([
    "Our wrap coat, ₦115,000, fits UK 8 to 14, made to order in 10 days.",
  ]);
  expect(inventedFacts("Fits UK 8 to 14, ₦115,000.", coat)).toEqual([]);
});

/* Round-7 live critic, travel: "Six days" in a rewrite was read as six of
   "Rome" and the rewrite refused, leaving facts off. */
it("reads a spelled-out count of days as days", () => {
  const rome = factLedger([
    "Rome in 6 days: guided Colosseum and Vatican tours, 4-star hotel near Termini.",
  ]);
  expect(inventedFacts("Six days in Rome, near Termini.", rome)).toEqual([]);
  expect(inventedFacts("Rome in six days", rome)).toEqual([]);
});

/* Round-14 code critic, finding 6: inventedFacts reads "one" as the
   tokenizer does, and neither counts it in a set phrase (ONE_IDIOMS). */
describe("inventedFacts, 'one' in a set phrase", () => {
  const market = factLedger([
    "Christmas market on Saturday 5 December from 5pm. 12 stalls.",
    "Christmas market",
  ]);
  it.each([
    "Gifts under one roof",
    "Everything in one place",
    "All-in-one gift box",
    "Your one-stop gift shop",
  ])("%j invents nothing", (headline) => {
    expect(inventedFacts(headline, market)).toEqual([]);
  });

  it("still flags 'one' counting what the brief never names", () => {
    expect(inventedFacts("One night only", market)).toContain("One");
  });
});
