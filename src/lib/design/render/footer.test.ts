import { describe, expect, it } from "vitest";
import {
  cornersBlockedByFooter,
  footerBandHeight,
  footerLinesFor,
  hasFooter,
} from "./footer";

const canvas = { width: 1080, height: 1350 };

/* KOOS-AI-001 phase 2. Module 05 catalogues twelve footer systems; the
   renderer had none, so contact details — the thing most real flyers carry —
   had nowhere to live that was actually drawn. The benchmark found the art
   director writing "[VENUE NAME], Lagos" into a field nothing rendered. */
/* Specs reaching the renderer are normally schema-parsed, so the fields are
   always present. Not every caller goes through the schema — tests and tools
   build a spec by hand — and a missing field must mean "no footer", never a
   crash halfway through a render. */
describe("a spec built without the footer fields", () => {
  it("reads as no footer rather than throwing", () => {
    const bare = {} as Parameters<typeof hasFooter>[0];

    expect(hasFooter(bare)).toBe(false);
    expect(footerLinesFor(bare)).toEqual([]);
    expect(footerBandHeight(bare, canvas)).toBe(0);
    expect(cornersBlockedByFooter(bare)).toEqual([]);
  });
});

describe("hasFooter", () => {
  it("is drawn when there are lines and a style that draws", () => {
    expect(hasFooter({ footerStyle: "bar", footerLines: ["Call us"] })).toBe(
      true,
    );
  });

  it.each([
    ["none", ["Call us"]],
    ["bar", []],
    ["text", []],
  ] as const)(
    "is not drawn for style %s with %j",
    (footerStyle, footerLines) => {
      expect(hasFooter({ footerStyle, footerLines: [...footerLines] })).toBe(
        false,
      );
    },
  );

  /* Module 05 §1: a celebration post often needs no footer at all, and an
     empty band is worse than none — it reads as a mistake. */
  it("is not drawn when the model asked for none", () => {
    expect(hasFooter({ footerStyle: "none", footerLines: [] })).toBe(false);
  });
});

describe("footerBandHeight", () => {
  it("gives a solid bar more room than plain text", () => {
    const bar = footerBandHeight(
      { footerStyle: "bar", footerLines: ["a"] },
      canvas,
    );
    const text = footerBandHeight(
      { footerStyle: "text", footerLines: ["a"] },
      canvas,
    );

    expect(bar).toBeGreaterThan(text);
  });

  it("grows with the number of lines", () => {
    const one = footerBandHeight(
      { footerStyle: "bar", footerLines: ["a"] },
      canvas,
    );
    const three = footerBandHeight(
      { footerStyle: "bar", footerLines: ["a", "b", "c"] },
      canvas,
    );

    expect(three).toBeGreaterThan(one);
  });

  /* The footer is utility information: it must never take so much of the
     canvas that the message it supports loses its room. */
  it("never takes more than a fifth of the canvas", () => {
    const tall = footerBandHeight(
      { footerStyle: "bar", footerLines: ["a", "b", "c"] },
      canvas,
    );

    expect(tall).toBeLessThanOrEqual(canvas.height * 0.2);
  });

  it("is zero when no footer is drawn", () => {
    expect(
      footerBandHeight({ footerStyle: "none", footerLines: [] }, canvas),
    ).toBe(0);
  });
});

describe("cornersBlockedByFooter", () => {
  /* A band across the bottom covers both bottom corners, so a logo placed
     there lands on the contact details. The compositor measures legibility
     after the fact, but it cannot move the mark — the corner has to be ruled
     out before placement. */
  it("rules out the bottom corners when a band is drawn", () => {
    expect(
      cornersBlockedByFooter({ footerStyle: "bar", footerLines: ["a"] }),
    ).toEqual(["bottom-left", "bottom-right"]);
  });

  it("blocks nothing when no footer is drawn", () => {
    expect(
      cornersBlockedByFooter({ footerStyle: "none", footerLines: [] }),
    ).toEqual([]);
  });
});

describe("footerLinesFor", () => {
  it("drops empty lines the model padded the array with", () => {
    expect(
      footerLinesFor({
        footerStyle: "bar",
        footerLines: ["Call us", "  ", ""],
      }),
    ).toEqual(["Call us"]);
  });

  /* Three is the cap: a fourth line turns a footer into a paragraph, which is
     module 05's "crowded" failure. */
  it("keeps at most three", () => {
    expect(
      footerLinesFor({
        footerStyle: "bar",
        footerLines: ["a", "b", "c", "d"],
      }),
    ).toHaveLength(3);
  });
});

/* FEAT-033 U3 live critique: two of four live designs said the call to
   action twice, once on the button and again in the footer. The button is
   the action; the footer is for what the button cannot carry. */
describe("footerLinesFor with the call to action", () => {
  const linesFor = (cta: string, footerLines: string[]) =>
    footerLinesFor({ footerStyle: "text", footerLines, cta });

  it("drops a line that is the call to action, whatever its case or punctuation", () => {
    expect(
      linesFor("Pre-order now", ["PRE-ORDER NOW!", "Lekki · Open 7am"]),
    ).toEqual(["Lekki · Open 7am"]);
  });

  it("drops the repeated item and keeps the rest of the line", () => {
    expect(linesFor("Order now", ["Order now · 0803 555 0142"])).toEqual([
      "0803 555 0142",
    ]);
    expect(
      linesFor("Order now", ["0803 555 0142 | Order now | Lekki"]),
    ).toEqual(["0803 555 0142 | Lekki"]);
  });

  /* Round 7: cutting the CTA off an item rewrote it, and "Order by 8pm
     for next-day pickup" under "Order by 8pm" was drawn as "Next-day
     pickup", losing the deadline. */
  it("keeps an item led by the call to action whole", () => {
    expect(
      linesFor("Order on WhatsApp", ["Order on WhatsApp: 0803 555 0142"]),
    ).toEqual(["Order on WhatsApp: 0803 555 0142"]);
    expect(
      linesFor("Order by 8pm", ["Order by 8pm for next-day pickup"]),
    ).toEqual(["Order by 8pm for next-day pickup"]);
  });

  it("drops an item that is part of the call to action or contains it", () => {
    expect(linesFor("Reserve your box today", ["Reserve your box"])).toEqual(
      [],
    );
    expect(
      linesFor("Book a table", ["Call us and book a table tonight"]),
    ).toEqual([]);
  });

  it("does not treat a one-word overlap as a repeat", () => {
    expect(linesFor("Shop", ["Shop 12, Admiralty Mall"])).toEqual([
      "Shop 12, Admiralty Mall",
    ]);
    expect(linesFor("Visit us in Lagos", ["Lagos"])).toEqual(["Lagos"]);
  });

  it("leaves lines alone when there is no call to action", () => {
    expect(linesFor("", ["Order now"])).toEqual(["Order now"]);
  });

  it("is no footer at all when every line repeated the call to action", () => {
    const spec = {
      footerStyle: "bar" as const,
      footerLines: ["Order now"],
      cta: "Order now",
    };
    expect(hasFooter(spec)).toBe(false);
    expect(footerBandHeight(spec, canvas)).toBe(0);
  });
});

/* Removing the CTA deleted the phone
   number, the address, the URL and the promo code it shared an item with,
   and cut a domain that happened to spell the CTA. A footer exists to carry
   exactly those, so an item with a fact in it is never deleted for repeating
   the CTA. */
describe("footerLinesFor never deletes contact details to avoid a repeat", () => {
  const linesFor = (cta: string, line: string) =>
    footerLinesFor({ footerStyle: "text", footerLines: [line], cta });

  it.each([
    ["Book a table", "Call 0803 555 0142 to book a table"],
    ["Order now", "WhatsApp to order now: 0803 555 0142"],
    ["Visit us", "Come visit us at 12 Admiralty Way, Lekki"],
    ["Get 20% off", "Use code CRUMB20 to get 20% off"],
    ["Order now", "ORDER-NOW.ng · Lekki"],
    ["Order now", "Pre-orders: order now for Christmas · hello@crumbandco.ng"],
  ])("keeps %j's footer %j whole", (cta, line) => {
    expect(linesFor(cta, line)).toEqual([line]);
  });

  it("splits items on commas and unspaced pipes, dropping only the CTA", () => {
    expect(
      linesFor("Order now", "crumbandco.ng, Order now, 0803 555 0142"),
    ).toEqual(["crumbandco.ng, 0803 555 0142"]);
    expect(linesFor("Order now", "Order now|0803 555 0142")).toEqual([
      "0803 555 0142",
    ]);
  });

  it("keeps an item led by the CTA whole, the address and code with it", () => {
    expect(linesFor("Visit us", "Visit us at 12 Admiralty Way, Lekki")).toEqual(
      ["Visit us at 12 Admiralty Way, Lekki"],
    );
    expect(linesFor("Get 20% off", "Get 20% off with code CRUMB20")).toEqual([
      "Get 20% off with code CRUMB20",
    ]);
  });
});

/* Five of seven live bakery footers repeated
   the subheadline's day and time, and stripping the CTA left "pickup from
   7am" starting in lower case. */
describe("footerLinesFor against the copy above it", () => {
  const linesFor = (spec: {
    cta?: string;
    subheadline?: string;
    headline?: string;
    footerLines: string[];
  }) => footerLinesFor({ footerStyle: "text", ...spec });

  it("drops a line the copy above already says word for word", () => {
    expect(
      linesFor({
        subheadline: "Strawberry mille-feuille, ready Monday from 7am.",
        footerLines: ["Ready Monday from 7 am.", "12 Admiralty Way, Lekki"],
      }),
    ).toEqual(["12 Admiralty Way, Lekki"]);
    expect(
      linesFor({
        headline: "Open 7am to 6pm",
        footerLines: ["7am to 6pm", "Closed Sundays · 7am to 6pm"],
      }),
    ).toEqual(["Closed Sundays · 7am to 6pm"]);
  });

  /* Round 3 dropped an item when its facts all appeared above, ignoring
     the words around them, and deleted offers, conditions and exclusions. */
  it.each([
    ["Now baking in Lekki", "Free delivery in Lekki"],
    ["Open 7am–6pm, fresh every morning", "Mon–Sat 7am–6pm"],
    ["Boxes from ₦5,000", "Delivery fee ₦5,000"],
    ["20% off this weekend", "Not 20% off on cakes"],
    ["Call 0803 555 0142", "WhatsApp only, no calls: 0803 555 0142"],
    ["Live jazz every Friday at 8pm", "Except Friday 24 Dec"],
    ["Pick up Monday at 7:00am", "Pickup Monday 7am"],
    ["Ikoyi pop-up", "Lekki · Ikoyi · Victoria Island"],
    ["Ready Monday from 7am", "Monday · 7 am · 12 Admiralty Way, Lekki"],
  ])("under %j keeps %j whole", (subheadline, line) => {
    expect(
      linesFor({ cta: "Order now", subheadline, footerLines: [line] }),
    ).toEqual([line]);
    expect(
      linesFor({
        cta: "Order now",
        headline: subheadline,
        footerLines: [line],
      }),
    ).toEqual([line]);
  });

  it("keeps an offer the CTA leads into", () => {
    expect(
      linesFor({ cta: "Order now", footerLines: ["Order now and save 20%"] }),
    ).toEqual(["Order now and save 20%"]);
    expect(
      linesFor({
        cta: "Order now",
        footerLines: ["Order now, pay on delivery"],
      }),
    ).toEqual(["Pay on delivery"]);
  });

  it("keeps a mixed-case name's case when it starts the line", () => {
    expect(
      linesFor({
        cta: "Get the app",
        footerLines: ["Get the app / iOS / Android"],
      }),
    ).toEqual(["iOS / Android"]);
  });

  it("keeps an item with a fact the copy above does not state", () => {
    expect(
      linesFor({
        subheadline: "Ready Monday from 7am.",
        footerLines: ["Open Monday to Saturday, 7am to 6pm"],
      }),
    ).toEqual(["Open Monday to Saturday, 7am to 6pm"]);
  });

  it("keeps an item with no facts at all", () => {
    expect(
      linesFor({ subheadline: "Ready from 7am", footerLines: ["Open daily"] }),
    ).toEqual(["Open daily"]);
  });

  it("starts a line that lost its first item with a capital", () => {
    expect(
      linesFor({
        cta: "Order ahead",
        footerLines: ["Order ahead · pickup from 7am"],
      }),
    ).toEqual(["Pickup from 7am"]);
  });

  it("never capitalises an address left at the start of a line", () => {
    expect(
      linesFor({
        cta: "Email us",
        footerLines: ["Email us · hello@crumbandco.ng"],
      }),
    ).toEqual(["hello@crumbandco.ng"]);
    expect(
      linesFor({
        cta: "Order now",
        footerLines: ["Order now · crumbandco.ng"],
      }),
    ).toEqual(["crumbandco.ng"]);
  });

  it("leaves a line the user wrote in lower case alone when nothing was cut", () => {
    expect(linesFor({ footerLines: ["open daily, 7am"] })).toEqual([
      "open daily, 7am",
    ]);
  });
});
