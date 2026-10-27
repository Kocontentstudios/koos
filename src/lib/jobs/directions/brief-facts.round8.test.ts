import { describe, expect, it } from "vitest";
import {
  aboveRepeats,
  type BriefFact,
  type FactCopy,
  factStated,
} from "./brief-facts";

/* The round-7 code critic's verifier probes (r7-verifier.log V1 to V3c,
   V10): a number with another meaning, and a price in another currency. */

const fact = (kind: BriefFact["kind"], text: string, needs: string[]) =>
  ({ kind, text, needs }) as BriefFact;
const copy = (over: Partial<FactCopy>): FactCopy => ({
  headline: "",
  footerLines: [],
  footerStyle: "none",
  ...over,
});

describe("a number fact keeps its own words around the number", () => {
  it.each([
    [
      "V1: the door time is not the age",
      fact("age", "Ages 8+", ["=8"]),
      copy({ subheadline: "Doors open 8pm at the Yaba hall." }),
    ],
    [
      "V1b: a street number is not the age",
      fact("age", "18+ only", ["=18"]),
      copy({ footerLines: ["18 Admiralty Way, Lekki"] }),
    ],
    [
      "V1c: a date and a time are not the age range",
      fact("age", "ages 5-12", ["=5", "=12"]),
      copy({ subheadline: "Starts Saturday 5 December at 12pm." }),
    ],
    [
      "V2: an age range is not the opening hours",
      fact("time", "9-5", ["=9", "=5"]),
      copy({ subheadline: "For ages 5-9, weekdays in Yaba." }),
    ],
    [
      "V10: a day of the month is not the count",
      fact("quantity", "8 seats", ["=8", "^seat"]),
      copy({ subheadline: "Saturday 8 November. Seats are limited." }),
    ],
  ])("%s", (_label, f, design) => {
    expect(factStated(f, design)).toBe(false);
  });

  it.each([
    [fact("age", "Ages 8+", ["=8"]), "Ages 8 and up"],
    [fact("age", "18+ only", ["=18"]), "Strictly 18+"],
    [fact("age", "ages 5-12", ["=5", "=12"]), "For ages 5 to 12"],
    [fact("time", "9-5", ["=9", "=5"]), "Open 9am–5pm"],
    [fact("quantity", "8 seats", ["=8", "^seat"]), "Only 8 seats left"],
    [fact("quantity", "only 15 made", ["=15"]), "Fifteen made"],
  ])("still reads %s as %s", (f, text) => {
    expect(factStated(f, copy({ subheadline: text }))).toBe(true);
  });
});

describe("a price is compared with its currency", () => {
  it.each([
    [
      "V3: ₦20 is not $20",
      fact("price", "$20 per class", ["=20", "^class"]),
      "₦20 per class.",
    ],
    [
      "V3b: a count is not a cedi price",
      fact("price", "GH₵50 per class", ["=50", "^class"]),
      "Join 50 others in class.",
    ],
    [
      "V3c: a count is not an NGN price",
      fact("price", "NGN 4,500 per box", ["=4500", "^box"]),
      "4,500 boxes sold last month.",
    ],
  ])("%s", (_label, f, text) => {
    expect(factStated(f, copy({ subheadline: text }))).toBe(false);
  });

  it.each([
    [fact("price", "$20 per class", ["=20", "^class"]), "Just $20 per class"],
    [fact("price", "GH₵50 per class", ["=50", "^class"]), "GHS 50 per class"],
    [fact("price", "NGN 4,500 per box", ["=4500", "^box"]), "₦4,500 per box"],
    [fact("price", "KSh 300 per cup", ["=300", "^cup"]), "KES 300 per cup"],
    [
      fact("price", "R250 per session", ["=250", "^session"]),
      "ZAR 250 per session",
    ],
  ])("reads %s in another spelling of its currency", (f, text) => {
    expect(factStated(f, copy({ subheadline: text }))).toBe(true);
  });

  it("holds a price with no currency it can read only whole", () => {
    const bare = fact("price", "4,500 per box", ["=4500", "^box"]);
    expect(factStated(bare, copy({ subheadline: "₦4,500 per box" }))).toBe(
      false,
    );
    expect(factStated(bare, copy({ subheadline: "Only 4,500 per box" }))).toBe(
      true,
    );
  });
});

/* Round-7 live critic: a fact in the headline said again in the
   subheadline, on five live directions. */
describe("aboveRepeats", () => {
  it.each([
    ["A Tray for ₦13,500", "Four slices for ₦13,500, this weekend only."],
    ["Your first 3 rides are free", "Your first 3 rides are free in Lagos."],
    ["Maths & Physics at Home", "Home maths and physics tutoring in Yaba."],
    [
      "Learn croissant lamination",
      "A croissant lamination weekend with Tunde Bakare.",
    ],
  ])("finds %s said again", (headline, subheadline) => {
    expect(aboveRepeats({ headline, subheadline })).not.toEqual([]);
  });

  it("passes a subheadline that adds what the headline does not say", () => {
    expect(
      aboveRepeats({
        headline: "A Tray for ₦13,500",
        subheadline: "Strawberry cream slices, this weekend only.",
        cta: "Preorder",
      }),
    ).toEqual([]);
  });
});
