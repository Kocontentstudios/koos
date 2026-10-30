import { describe, expect, it } from "vitest";
import { type CoverKind, factStated, needsFor } from "./brief-facts";

/*
 * A count of days before a time ("Six Saturdays, 9am to 12pm") counts the
 * sessions; the number is not a rival hour. The sequence planner wrote that
 * headline, the verifier missed the time, and code drew "9am to 12pm" again
 * in the footer of the same frame.
 */

const fact = (kind: CoverKind, text: string) => ({
  kind,
  text,
  needs: needsFor(kind, text),
});

const asHeadline = (headline: string) => ({
  headline,
  subheadline: "",
  cta: "",
  footerLines: [],
  footerStyle: "none" as const,
});

const asSubheadline = (subheadline: string) => ({
  headline: "Class",
  subheadline,
  cta: "",
  footerLines: [],
  footerStyle: "none" as const,
});

const COUNTED_DAYS = [
  "Six Saturdays, 9am to 12pm",
  "6 Saturdays, 9am to 12pm",
  "Six Saturdays 9am to 12pm",
  "Classes run six Saturdays, 9am to 12pm",
  "Saturdays, 9am to 12pm",
  "Every Saturday, 9am to 12pm",
  "Join us 6 Saturdays, 9am to 12pm",
  "Six Saturday mornings, 9am to 12pm",
  "6 Saturday mornings, 9am to 12pm",
  "We meet 8 Tuesdays, 9am to 12pm",
];

/* An hour written in digits after a word, before a day word, is still a
   second hour beside the fact's. */
const HOURS_STILL_RIVAL = [
  "Doors 6 Fridays, 9am to 12pm Saturdays",
  "Doors 9am to 12pm, 8 Fridays",
  "Doors 9am to 12pm (8 weekends)",
  "Gates 7 Saturdays, 9am to 12pm",
  "Open from 6 Saturdays, 9am to 12pm",
];

describe("factStated: a time after a count of days", () => {
  const time = fact("time", "9am to 12pm");

  it.each(COUNTED_DAYS)("states the time in the headline %j", (text) => {
    expect(factStated(time, asHeadline(text))).toBe(true);
  });

  it.each(COUNTED_DAYS)("states the time in the subheadline %j", (text) => {
    expect(factStated(time, asSubheadline(text))).toBe(true);
  });

  it.each(HOURS_STILL_RIVAL)("still refuses a rival hour in %j", (text) => {
    expect(factStated(time, asSubheadline(text))).toBe(false);
  });

  it("still reads a lone count of days as no time", () => {
    expect(factStated(time, asHeadline("Six Saturdays"))).toBe(false);
  });
});

/*
 * A count after the verb that counts it ("The round buys 5,000 kits",
 * "Revenue grew 3x in 2025") states the brief's count. Read as unstated,
 * code drew the same figure again in the slide's footer.
 */
describe("factStated: a count after its verb", () => {
  it.each([
    ["5,000 more kits", "The round buys 5,000 more kits"],
    ["5,000 kits", "Sunbox funds 5,000 kits"],
    ["3x in 2025", "Revenue grew 3x in 2025"],
    ["3,400 shops", "We serve 3,400 shops"],
    ["120 students", "Volunteers taught 120 students"],
  ])("states %j in %j", (count, text) => {
    expect(factStated(fact("quantity", count), asHeadline(text))).toBe(true);
  });

  it("still refuses another count of the same noun", () => {
    expect(
      factStated(
        fact("quantity", "5,000 kits"),
        asHeadline("The round buys 4,000 kits"),
      ),
    ).toBe(false);
  });
});
