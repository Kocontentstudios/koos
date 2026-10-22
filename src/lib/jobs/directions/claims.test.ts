import { describe, expect, it } from "vitest";
import {
  type DrawnCopy,
  factLedger,
  inventedFacts,
  looksCutOff,
  productFromBrief,
  type ReasonContext,
  reasonHolds,
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
    expect(inventedFacts("₦3,900 this week", bakery)).toEqual(["₦3,900"]);
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
