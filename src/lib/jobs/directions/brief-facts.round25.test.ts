import { describe, expect, it } from "vitest";
import {
  type BriefFact,
  type CoverKind,
  factStated,
  needsFor,
  settleBriefFacts,
} from "./brief-facts";

/*
 * Round-10 live verdict, CB1: "available from Monday" lost its "from", or
 * was negated, and still counted as stated. Every probe and live string of
 * the verdict is a false row; the bound and its polarity are part of the
 * fact (day-qualifier.ts).
 */

const fact = (kind: CoverKind, text: string): BriefFact => ({
  kind,
  text,
  needs: needsFor(kind, text),
});

const copy = (
  headline: string,
  subheadline = "",
  cta = "",
  footerLines: string[] = [],
) => ({ headline, subheadline, cta, footerLines });

const BAKERY =
  "Launch our new strawberry mille-feuille, ₦4,500 a slice, available from Monday. Commuters can order ahead for pickup from 7am.";

const FALSE_ROWS: [string, ReturnType<typeof copy>][] = [
  [
    "run 1 s1",
    copy(
      "Your Monday treat is ready.",
      "Strawberry mille-feuille, ₦4,500 a slice — order ahead for pickup.",
      "Order for Pickup",
      ["Pickup from 7am"],
    ),
  ],
  [
    "run 2 s0",
    copy(
      "Strawberry Mille-Feuille",
      "Order ahead for Monday pickup.",
      "Order Ahead",
      ["₦4,500 a slice"],
    ),
  ],
  [
    "builder s0",
    copy(
      "Strawberry Mille-Feuille",
      "Order ahead for pickup from 7am on Monday.",
      "Order Ahead",
      ["₦4,500 a slice"],
    ),
  ],
  [
    "builder s1",
    copy(
      "Worth the Early Start",
      "Our new strawberry mille-feuille is ₦4,500 a slice. Order ahead for pickup from 7am on Monday.",
      "Order for Monday",
    ),
  ],
  ["button alone", copy("Strawberry Mille-Feuille", "", "Order for Monday")],
  ["closed", copy("Strawberry Mille-Feuille", "Closed on Monday.")],
  ["not available", copy("Strawberry Mille-Feuille", "Not available Monday.")],
  ["until only", copy("Strawberry Mille-Feuille", "Until Monday only.")],
  [
    "footer negated",
    copy("Strawberry Mille-Feuille", "", "", ["Pickup 7am · Closed Monday"]),
  ],
  [
    "every Monday",
    copy("Strawberry Mille-Feuille", "Ready for pickup from 7am every Monday."),
  ],
  ["Mondays only", copy("Strawberry Mille-Feuille", "Mondays only, from 7am.")],
];

const TRUE_ROWS: [string, ReturnType<typeof copy>][] = [
  ["available from", copy("Strawberry Mille-Feuille", "Available from Monday")],
  [
    "from, comma",
    copy("Strawberry Mille-Feuille", "From Monday, ₦4,500 a slice."),
  ],
  [
    "footer item",
    copy("Strawberry Mille-Feuille", "", "", [
      "₦4,500 a slice · Available from Monday",
    ]),
  ],
  ["starting", copy("Strawberry Mille-Feuille", "Starting Monday")],
  ["onwards", copy("Strawberry Mille-Feuille", "Monday onwards")],
  [
    "a wrong day beside a right one",
    copy("Your Monday treat", "Available from Monday."),
  ],
];

describe("round 25, CB1: a day keeps its bound and its polarity", () => {
  for (const text of ["available from Monday", "from Monday"]) {
    it.each(FALSE_ROWS)(`"${text}" is not stated by %s`, (_, design) => {
      expect(factStated(fact("day", text), design)).toBe(false);
    });
    it.each(TRUE_ROWS)(`"${text}" is stated by %s`, (_, design) => {
      expect(factStated(fact("day", text), design)).toBe(true);
    });
  }

  it("holds a date's bound the same way", () => {
    const deadline = fact("date", "Apply by 30 November");
    expect(factStated(deadline, copy("Apply by 30 November"))).toBe(true);
    expect(factStated(deadline, copy("Interviews 30 November"))).toBe(false);
    expect(factStated(deadline, copy("Closed 30 November"))).toBe(false);
  });

  it("never counts a negated date for a plain one", () => {
    const reopening = fact("date", "Saturday 12 December");
    expect(factStated(reopening, copy("Saturday 12 December"))).toBe(true);
    expect(factStated(reopening, copy("Closed Saturday 12 December"))).toBe(
      false,
    );
  });

  it("keeps a plain day plain: no bound is asked for", () => {
    const market = fact("day", "Saturday");
    expect(factStated(market, copy("This Saturday at the market"))).toBe(true);
  });

  it("takes the brief's bound into a day the reader returned bare", () => {
    const read = settleBriefFacts([{ kind: "day", text: "Monday" }], BAKERY, {
      product: "strawberry mille-feuille",
    });
    expect(read.facts.map((f) => f.text)).toEqual(["From Monday"]);
    const [day] = read.facts;
    expect(factStated(day, FALSE_ROWS[0][1])).toBe(false);
    expect(factStated(day, TRUE_ROWS[0][1])).toBe(true);
  });
});
