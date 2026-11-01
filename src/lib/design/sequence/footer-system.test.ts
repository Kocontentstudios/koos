import { describe, expect, it } from "vitest";
import { beatOf, cafePlan } from "./fixtures";
import { hasOneFooterSystem, withOneFooterSystem } from "./footer-system";

/* Integration round 2, MEDIUM 3: run 1's set had no footer on frames 1 and
   3, a bar holding only "Saturday 14 November" on frame 2 and a bar of
   three lines on the close. */
const lumen = (bodyLines: string[], actionLines: string[]) =>
  cafePlan({
    frames: [
      beatOf({ role: "hook", headline: "Steeped 20 hours", footerLines: [] }),
      beatOf({
        headline: "Buy two, get a free pastry",
        footerLines: bodyLines,
      }),
      beatOf({ headline: "Single-origin Ethiopian beans", footerLines: [] }),
      beatOf({
        role: "cta",
        headline: "Order ahead",
        cta: "Order on WhatsApp",
        footerLines: actionLines,
      }),
    ],
  });

describe("withOneFooterSystem", () => {
  it("moves a body frame's line onto the close, so only the close draws a footer", () => {
    const settled = withOneFooterSystem(
      lumen(
        ["Saturday 14 November"],
        ["N3,500 a bottle", "WhatsApp 0812 555 0199"],
      ),
    );
    expect(settled.frames.map((f) => f.footerLines)).toEqual([
      [],
      [],
      [],
      ["N3,500 a bottle", "WhatsApp 0812 555 0199", "Saturday 14 November"],
    ]);
    expect(hasOneFooterSystem(settled.frames)).toBe(true);
  });

  it("never says a line twice on the close", () => {
    const settled = withOneFooterSystem(
      lumen(
        ["Saturday 14 November"],
        [
          "Saturday 14 November, 8am to 2pm",
          "WhatsApp 0812 555 0199",
          "N3,500",
        ],
      ),
    );
    expect(settled.frames[1].footerLines).toEqual([]);
    expect(settled.frames[3].footerLines).toHaveLength(3);
  });

  it("pairs a line beside the shortest one on a full close", () => {
    const settled = withOneFooterSystem(
      lumen(
        ["8am to 2pm"],
        ["N3,500 a bottle", "our Yaba shop", "WhatsApp 0812 555 0199"],
      ),
    );
    expect(settled.frames[3].footerLines).toEqual([
      "N3,500 a bottle",
      "our Yaba shop · 8am to 2pm",
      "WhatsApp 0812 555 0199",
    ]);
  });

  it("never pairs a line onto a price or a phone number", () => {
    const settled = withOneFooterSystem(
      lumen(
        ["8am to 2pm"],
        ["N3,500 a bottle", "Saturday 14 November", "WhatsApp 0812 555 0199"],
      ),
    );
    expect(settled.frames[3].footerLines).toEqual([
      "N3,500 a bottle",
      "Saturday 14 November · 8am to 2pm",
      "WhatsApp 0812 555 0199",
    ]);
  });

  it("leaves the set as it was when the close has no room for every line", () => {
    const plan = lumen(
      ["Collect from the Herbert Macaulay Way shop"],
      [
        "N3,500 a bottle, two for N6,500",
        "our Yaba shop (12 Herbert Macaulay Way)",
        "WhatsApp 0812 555 0199 to order",
      ],
    );
    expect(withOneFooterSystem(plan)).toBe(plan);
  });

  it("leaves a set that already has one system untouched", () => {
    const plan = lumen([], ["WhatsApp 0812 555 0199"]);
    expect(withOneFooterSystem(plan)).toBe(plan);
  });
});
