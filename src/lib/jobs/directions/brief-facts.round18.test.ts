import { describe, expect, it } from "vitest";
import { buildDirectionsSystemPrompt } from "@/lib/ai/prompts/design-directions";
import { type CoverKind, factStated, needsFor } from "./brief-facts";

/*
 * Round 18: a count's rival is another count of what the fact counts.
 * Round 17 took any bare number in the field as a count's rival, which
 * went past Oluwaseyi's "of its kind" ruling of 2026-10-28; the
 * orchestrator's round-17 brief asked for it and corrected itself. The
 * paid eval at 5003e9e refused the correct copy in EVAL_5003E9E. Times,
 * prices and dates keep the round-17 field-wide rule unchanged.
 */

const fact = (kind: CoverKind, text: string) => ({
  kind,
  text,
  needs: needsFor(kind, text),
});

const design = (subheadline: string, footerLines: string[] = []) => ({
  headline: "Class",
  subheadline,
  cta: "",
  footerLines,
  footerStyle: footerLines.length > 0 ? ("text" as const) : ("none" as const),
});

type Row = [label: string, text: string, copy: ReturnType<typeof design>];

/* Refused at 5003e9e as "beside another value of its kind". */
const EVAL_5003E9E: Row[] = [
  [
    "a date's day and one artisan beside twelve throws",
    "Twelve new throws and cushions",
    design(
      "The autumn aso-oke collection launches 3 November — twelve new throws and cushions, each woven by one artisan.",
    ),
  ],
  [
    "an address number beside a stock count",
    "only 20 pieces",
    design("", ["Only 20 pieces · 12 Ozumba Mbadiwe Avenue, VI"]),
  ],
  [
    "a duration and class codes beside a session count",
    "Two 90-minute sessions a week",
    design(
      "For SS1 to SS3 students in Surulere and Yaba, with two 90-minute sessions a week.",
    ),
  ],
  [
    "class codes on the same line",
    "Two 90-minute sessions a week",
    design("SS1 to SS3 · Two 90-minute sessions a week"),
  ],
];

/* Numbers that are never a count's rival. */
const NOT_A_COUNT: Row[] = [
  ["another noun", "10 seats", design("10 seats · 2 hours")],
  ["another noun, singular", "10 seats", design("10 seats, 1 instructor")],
  ["another plural noun", "10 seats", design("10 seats in 2 rooms")],
  ["a day beside its month", "10 seats", design("10 seats, 5 December")],
  ["an ordinal day", "10 seats", design("10 seats on the 5th")],
  ["a clock time", "10 seats", design("10 seats, from 6pm")],
  ["an amount", "10 seats", design("10 seats at ₦25,000")],
  [
    "an address",
    "10 seats",
    design("10 seats · 12 Herbert Macaulay Way, Yaba"),
  ],
  ["a numbered place", "10 seats", design("10 seats · Shop 12, Balogun")],
  ["a plot", "10 seats", design("Plot 5, 10 seats")],
  ["a code", "10 seats", design("10 seats for JSS3")],
  ["a year", "10 seats", design("10 seats for 2026")],
  ["an age", "10 seats", design("10 seats, 18+")],
  ["an age range", "only 8 spots", design("Ages 7 to 12 · Only 8 spots")],
  ["an age and over", "10 seats", design("10 seats, 16 and over")],
  ["a phone", "10 seats", design("10 seats · Call 0803 555 0142")],
  ["a share", "10 seats", design("10 seats, 20% off")],
  ["a rate", "16 places", design("16 places, 2 per room")],
  ["a measure", "10 seats", design("10 seats · 5kg of clay each")],
];

/* Another count of the same thing: the critic's fail-open rows (rounds
   14 to 17) and this round's attack. Each must stay refused. */
const RIVALS: Row[] = [
  ["Q4: a synonym", "10 seats", design("10 seats or 12 spots")],
  ["Q14: rows of the count", "10 seats", design("5 rows of 10 seats")],
  ["Q13: times the count", "10 seats", design("5 x 10 seats")],
  ["a container times", "10 seats", design("5 tables x 10 seats")],
  ["a container of", "10 seats", design("2 sessions of 10 seats")],
  ["Q12: an ordinal of", "10 seats", design("10th of 10 seats")],
  ["G17: one of", "10 seats", design("1 of 10 seats left")],
  ["B17: one in", "10 seats", design("One in 10 seats")],
  ["B18: out of", "10 seats", design("1 out of 10 seats")],
  ["X8: bare after", "16 places", design("16 places, or 20")],
  ["X16: bare in brackets", "10 seats", design("10 seats (or 12)")],
  ["Q1: bare before", "10 seats", design("Eight or 10 seats")],
  ["Q3: a bare word", "10 seats", design("10 seats or twelve")],
  ["Q5: the same noun", "10 seats", design("10 seats, or 12 seats on Sunday")],
  ["Q6: a bare count and when", "10 seats", design("10 seats (12 on Sunday)")],
  ["Q7: a range", "10 seats", design("Eight to 10 seats")],
  ["Q8: a dozen", "10 seats", design("A dozen or 10 seats")],
  ["Q9: the same noun past a dash", "10 seats", design("10 seats — 12 seats")],
  ["B29: versus", "10 seats", design("10 seats vs 20 seats")],
  ["C5a: between", "10 seats", design("Between 2 and 10 seats")],
  ["C11: and", "10 seats", design("Tables for 4 and 10 seats")],
  ["C15: a ratio", "10 seats", design("Your 1 in 10 seats")],
  ["K10: words", "six pastries", design("Six or seven pastries")],
  [
    "K13: a shared noun",
    "20 African countries",
    design("Send to 15 or 20 African countries"),
  ],
  ["K37", "only 8 spots", design("Only 6 or 8 spots")],
  ["K53", "16 places", design("12 or 16 places")],
  ["H53", "16 places", design("From 8 to 16 places")],
  ["guests for seats", "10 seats", design("10 seats for 12 guests")],
  ["students for seats", "10 seats", design("10 seats or 12 students")],
  [
    "a count left bare by a modifier",
    "10 seats",
    design("10 seats, twelve more"),
  ],
  ["a total", "10 seats", design("10 seats, 12 total")],
  ["a total, in", "10 seats", design("10 seats, 12 in total")],
  ["a maximum", "10 seats", design("10 seats, 12 max")],
  ["a plural that is no noun", "10 seats", design("10 seats, 12 tops")],
  ["a participle", "10 seats", design("10 seats, 2 booked")],
  ["sold", "10 seats", design("10 seats, 12 sold")],
  ["one booked", "10 seats", design("10 seats, 1 booked")],
  [
    "a street word that is no address",
    "10 seats",
    design("10 seats or 12 at the market"),
  ],
  [
    "an address in capitals",
    "10 seats",
    design("10 SEATS OR 12 AT THE MARKET"),
  ],
  ["a group's singular in -ss", "2 classes", design("2 classes or 3 sessions")],
  ["a singular in -ss", "2 sessions", design("2 sessions or 1 class")],
  [
    "a word that names nothing counted",
    "10 seats",
    design("10 seats, 12 guaranteed"),
  ],
  ["a count before", "10 seats", design("12 · 10 seats")],
  ["up to", "10 seats", design("10 seats — up to 12")],
  ["a later sentence", "10 seats", design("Ten seats. Twelve, if needed.")],
  ["capitals", "10 seats", design("10 SEATS OR 12")],
  ["a capital word with a vowel", "10 seats", design("10 SEATS · CAP 12")],
  ["title case", "10 seats", design("10 Seats · 12 Max")],
  ["per row", "10 seats", design("10 seats per row, 5 rows")],
  ["each", "10 seats", design("10 seats each, 5 tables")],
  ["a table", "10 seats", design("10 seats a table, 5 tables")],
  [
    "r9 FP9: max per table",
    "50 guests",
    design("50 guests max per table, 3 tables"),
  ],
];

describe("round 18: a count's rival counts the same thing", () => {
  it.each(EVAL_5003E9E)("eval 5003e9e, %s: %s", (_label, text, copy) => {
    expect(factStated(fact("quantity", text), copy)).toBe(true);
  });
  it.each(NOT_A_COUNT)("not a count: %s (%s)", (_label, text, copy) => {
    expect(factStated(fact("quantity", text), copy)).toBe(true);
  });
  it.each(RIVALS)("a rival: %s (%s)", (_label, text, copy) => {
    expect(factStated(fact("quantity", text), copy)).toBe(false);
  });
});

/* Times, prices and dates keep the field-wide rule of round 17. */
describe("round 18 leaves the other kinds field-wide", () => {
  it.each([
    ["time", "6pm", "Doors 6pm, then 12 stalls till late, or 7pm"],
    ["price", "₦6,000", "Three shots, ₦6,000, or ₦5,000"],
    ["date", "5 December", "5 December, or 6"],
  ] as const)("%s %s in %j", (kind, text, sub) => {
    expect(factStated(fact(kind, text), design(sub))).toBe(false);
  });
});

/* Round 17 told the drafting model a count shares its field with no other
   number; the model is held to the narrower rule now. */
describe("the drafting prompt states the narrowed count rule", () => {
  const prompt = buildDirectionsSystemPrompt({ name: "Lagos Loom" }, false);
  it("names what a count may stand beside", () => {
    expect(prompt).toContain(
      '"10 seats · 18+", "Only 20 pieces · 12 Ozumba Mbadiwe Avenue"',
    );
    expect(prompt).not.toContain('"10 seats · 18+" states no count');
  });
});
