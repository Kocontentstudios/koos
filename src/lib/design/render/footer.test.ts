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

  it("keeps what follows a call to action used as a label", () => {
    expect(
      linesFor("Order on WhatsApp", ["Order on WhatsApp: 0803 555 0142"]),
    ).toEqual(["0803 555 0142"]);
    expect(linesFor("Order now", ["Order now at crumbandco.ng"])).toEqual([
      "crumbandco.ng",
    ]);
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
