import { describe, expect, it } from "vitest";
import {
  type CoverKind,
  contradictedDates,
  factStated,
  needsFor,
  withoutContradictedDates,
} from "./brief-facts";

/*
 * Round-16 code critic, finding 1 (/tmp/feat-033/critique/
 * u3-code-verdict-round16.md): `rivalled` looked one token past the run,
 * so "6am, or 7am" stated "6am". Oluwaseyi's ruling of 2026-10-28 makes
 * the rival rule field-wide: a time, price, date or count is refused when
 * any other value of its kind stands anywhere in the same field (the
 * headline, the subheadline, the button or one drawn footer line). Rows
 * are the critic's, labelled before any run (r16-holdout.mts X rows,
 * r16-attack.mts), beside the copy that must still stand.
 */

const fact = (kind: CoverKind, text: string) => ({
  kind,
  text,
  needs: needsFor(kind, text),
});

const design = (
  headline: string,
  subheadline = "",
  footerLines: string[] = [],
  cta = "",
) => ({
  headline,
  subheadline,
  cta,
  footerLines,
  footerStyle: footerLines.length > 0 ? ("text" as const) : ("none" as const),
});

type Row = [
  id: string,
  kind: CoverKind,
  text: string,
  copy: ReturnType<typeof design>,
  stated: boolean,
];

/* A second value past a mark and a word: each stated at 2d4facf. */
const FAIL_OPEN_AT_2D4FACF: Row[] = [
  ["X2", "time", "6am", design("HIIT", "Every weekday at 6am, or 7am"), false],
  [
    "X18",
    "time",
    "from 8am",
    design("Espresso flight", "Weekdays from 8am, or 9am"),
    false,
  ],
  [
    "X3",
    "date",
    "3 November",
    design("Autumn aso-oke", "Launching 3 November, or the 4th"),
    false,
  ],
  [
    "X15",
    "date",
    "12 February",
    design("Made for two", "Pre-orders close 12 February — or the 13th"),
    false,
  ],
  [
    "X6",
    "date",
    "30 November",
    design("We're hiring", "Apply by 30 November (or 15 December)"),
    false,
  ],
  [
    "X5",
    "price",
    "₦6,000",
    design("Espresso flight", "Three shots, ₦6,000, or ₦5,000"),
    false,
  ],
  [
    "X8",
    "quantity",
    "16 places",
    design("Breathe out", "16 places, or 20"),
    false,
  ],
  [
    "X16",
    "quantity",
    "10 seats",
    design("Latte art", "10 seats (or 12)"),
    false,
  ],
  [
    "X12",
    "time",
    "10am to 12pm",
    design("Little bakers", "Saturday 10am to 12pm, or 2pm to 4pm"),
    false,
  ],
  [
    "X14",
    "time",
    "4pm",
    design("Building for Heat", "Panel 4pm. Or 5pm."),
    false,
  ],
  ["D2", "date", "5 December", design("Market", "5 December, or 6"), false],
  [
    "D5",
    "date",
    "5 December",
    design("Market", "5 December (and 6 December)"),
    false,
  ],
  ["T1", "time", "6pm", design("Doors", "Doors 6pm, or 7pm"), false],
  ["T2", "time", "6pm", design("Doors", "Doors 6pm (or 7pm)"), false],
  ["T9", "time", "6pm", design("Doors", "Doors 6pm. Or 7pm."), false],
  [
    "Q4",
    "quantity",
    "10 seats",
    design("Class", "10 seats or 12 spots"),
    false,
  ],
  ["Q14", "quantity", "10 seats", design("Class", "5 rows of 10 seats"), false],
];

/* A value of the kind the tokenizer does not type: a bare or decimal hour
   beside a time, an amount without its currency beside a price, a day
   before the date that takes its month, an ordinal beside a count. */
const UNTYPED_RIVALS: Row[] = [
  ["T12", "time", "7pm", design("Doors", "Doors 6.30 or 7pm"), false],
  ["T14", "time", "7pm", design("Doors", "Six or 7pm"), false],
  ["T19", "time", "7pm", design("Doors", "7pm or 9"), false],
  ["T20", "time", "7pm", design("Doors", "From 5, 7pm"), false],
  ["P3", "price", "₦4,500", design("Cake", "₦4,500 or 6k"), false],
  ["P10", "price", "₦6,000", design("Cake", "4,500 or ₦6,000"), false],
  [
    "P11",
    "price",
    "₦6,000",
    design("Cake", "Four thousand five hundred or ₦6,000"),
    false,
  ],
  ["Q12", "quantity", "10 seats", design("Class", "10th of 10 seats"), false],
  ["B14", "date", "5 December", design("Market", "4, 5 December"), false],
  [
    "K9",
    "date",
    "12 February",
    design("Valentine box", "Order 10 through 12 February"),
    false,
  ],
  [
    "K22",
    "date",
    "30 November",
    design("We're hiring", "Apply between 1 and 30 November"),
    false,
  ],
  [
    "W20",
    "date",
    "Saturday 5 December 2026",
    design("Christmas market", "5 December '25"),
    false,
  ],
  [
    "a day after the date in its clause",
    "date",
    "5 December",
    design("Market", "5 December or 6 if it rains"),
    false,
  ],
];

/* Correct copy the ruling refuses, on the spec's fail-closed list: two
   values of a kind in one field read as a choice. The fact writer gives
   each its own field. */
const FAIL_CLOSED: Row[] = [
  [
    "K18",
    "time",
    "4pm",
    design("Building for Heat", "Doors 3pm, panel 4pm"),
    false,
  ],
  [
    "K3",
    "price",
    "₦4,500 a slice",
    design("Mille-feuille", "₦4,500 a slice, or ₦30,000 the whole cake"),
    false,
  ],
  [
    "K30",
    "price",
    "₦38,000",
    design("Harmattan dress", "₦38,000 or 3 for ₦100,000"),
    false,
  ],
  ["G17", "quantity", "10 seats", design("Class", "1 of 10 seats left"), false],
  [
    "H41",
    "time",
    "4pm",
    design("Building for Heat", "Friday 14 March at 4pm (doors 3.30pm)"),
    false,
  ],
  [
    "H13",
    "time",
    "from 8am",
    design(
      "Three shots, one origin",
      "Three single-origin shots for ₦6,000, weekdays from 8am.",
    ),
    false,
  ],
  [
    "two dated days",
    "date",
    "Saturday 5 December",
    design("Christmas market", "Saturday 5 December and Sunday 6 December"),
    false,
  ],
  [
    "a count in the date's clause",
    "date",
    "5 December",
    design("Market", "5 December with 12 stalls"),
    false,
  ],
];

/* What still stands: no other value of the kind in the field, a value the
   run itself holds, or the other value in another field. */
const STANDS: Row[] = [
  [
    "H8",
    "date",
    "Friday 14 March",
    design(
      "Building for Heat",
      "Architect Ada Obi on cooler cities. Friday 14 March, 4pm, Landmark Centre.",
    ),
    true,
  ],
  [
    "H9",
    "time",
    "4pm",
    design(
      "Building for Heat",
      "Architect Ada Obi on cooler cities. Friday 14 March, 4pm, Landmark Centre.",
    ),
    true,
  ],
  [
    "H12",
    "price",
    "₦6,000",
    design(
      "Three shots, one origin",
      "Three single-origin shots for ₦6,000, weekdays from 8am.",
    ),
    true,
  ],
  [
    "the range's own other end",
    "time",
    "6pm to 9pm",
    design("Pottery", "", ["Thursday 20 November · 6pm to 9pm"]),
    true,
  ],
  [
    "a date beside its time",
    "date",
    "Thursday 20 November",
    design("Pottery", "", ["Thursday 20 November · 6pm to 9pm"]),
    true,
  ],
  [
    "a count beside a price",
    "quantity",
    "10 seats",
    design("Pottery", "", ["₦25,000 a seat · 10 seats"]),
    true,
  ],
  [
    "H31: a count beside an age (round 18)",
    "quantity",
    "10 seats",
    design("Throw your first pot", "", ["₦25,000 a seat · 18+ · 10 seats"]),
    true,
  ],
  [
    "a price beside an age and a count",
    "price",
    "₦25,000 a seat",
    design("Pottery", "", ["₦25,000 a seat · 18+ · 10 seats"]),
    true,
  ],
  [
    "a date then what it has",
    "date",
    "5 December",
    design("Market", "5 December, 12 stalls"),
    true,
  ],
  [
    "K15: a price on a phone's line",
    "price",
    "₦2,000 each",
    design("Chin chin", "", ["₦2,000 each · WhatsApp 0803 555 0142"]),
    true,
  ],
  [
    "a count beside a phone",
    "quantity",
    "10 seats",
    design("Class", "", ["10 seats · Call 08035550142"]),
    true,
  ],
  [
    "the same value again",
    "time",
    "6pm",
    design("Doors 6pm", "Doors open at 6pm sharp"),
    true,
  ],
  [
    "the rival in another field",
    "time",
    "6pm",
    design("Doors 6pm", "Panel at 7pm"),
    true,
  ],
  [
    "the rival on another footer line",
    "quantity",
    "10 seats",
    design("Pottery", "", ["10 seats", "18+ only"]),
    true,
  ],
  [
    "a count before a later sentence's date",
    "date",
    "3 November",
    design(
      "Autumn aso-oke",
      "Twelve throws and cushions in rust and indigo. Launching 3 November.",
    ),
    true,
  ],
];

describe("round 17: a value of the fact's kind anywhere in its field refuses it", () => {
  it.each(FAIL_OPEN_AT_2D4FACF)(
    "%s: %s %j",
    (_id, kind, text, copy, stated) => {
      expect(factStated(fact(kind, text), copy)).toBe(stated);
    },
  );
  it.each(UNTYPED_RIVALS)("%s: %s %j", (_id, kind, text, copy, stated) => {
    expect(factStated(fact(kind, text), copy)).toBe(stated);
  });
  it.each(FAIL_CLOSED)("%s: %s %j", (_id, kind, text, copy, stated) => {
    expect(factStated(fact(kind, text), copy)).toBe(stated);
  });
  it.each(STANDS)("%s: %s %j", (_id, kind, text, copy, stated) => {
    expect(factStated(fact(kind, text), copy)).toBe(stated);
  });
});

/* Round-16 code critic, finding 4 (J30): a field the fact writer could
   not move off the wrong day shipped. Code leaves off the sentence, the
   footer line or the button, and fails the direction for a headline. It
   never writes copy. */
describe("withoutContradictedDates", () => {
  const facts = [
    fact("date", "Saturday 5 December"),
    fact("date", "Sunday 6 December"),
  ];

  it("leaves off only the sentence that gives the wrong day", () => {
    const out = withoutContradictedDates(
      design(
        "Christmas market",
        "Crafts on Sunday morning, 5 December. Food on Sunday 6 December.",
      ),
      facts,
    );
    expect(out.direction.subheadline).toBe("Food on Sunday 6 December.");
    expect(out.failed).toBe(false);
    expect(out.settled).toEqual([
      expect.objectContaining({
        field: "subheadline",
        run: "5 December",
        action: "dropped",
      }),
    ]);
    expect(contradictedDates(facts, out.direction)).toEqual([]);
  });

  it("leaves off a subheadline that is one sentence", () => {
    const out = withoutContradictedDates(
      design("Christmas market", "Crafts on Sunday, 5 December"),
      facts,
    );
    expect(out.direction.subheadline).toBeUndefined();
    expect(out.failed).toBe(false);
  });

  it("leaves off the footer line, keeping the others", () => {
    const out = withoutContradictedDates(
      design("Christmas market", "Crafts and food in Lekki.", [
        "Sunday · 5 December",
        "Lekki Phase 1",
      ]),
      facts,
    );
    expect(out.direction.footerLines).toEqual(["Lekki Phase 1"]);
    expect(out.direction.subheadline).toBe("Crafts and food in Lekki.");
  });

  it("leaves off the button", () => {
    const out = withoutContradictedDates(
      design(
        "Christmas market",
        "Crafts and food.",
        [],
        "Come Sunday 5 December",
      ),
      facts,
    );
    expect(out.direction.cta).toBeUndefined();
    expect(out.failed).toBe(false);
  });

  it("fails the direction when the headline gives the wrong day", () => {
    const out = withoutContradictedDates(
      design("Sunday market, 5 December", "Crafts and food."),
      facts,
    );
    expect(out.failed).toBe(true);
    expect(out.direction.headline).toBe("Sunday market, 5 December");
    expect(out.settled).toEqual([
      expect.objectContaining({ field: "headline", action: "failed" }),
    ]);
  });

  it("leaves a design with no wrong day as it is", () => {
    const copy = design("Christmas market", "Crafts on Saturday 5 December.", [
      "Food on Sunday 6 December",
    ]);
    const out = withoutContradictedDates(copy, facts);
    expect(out.direction).toBe(copy);
    expect(out.settled).toEqual([]);
  });
});

/* Two dated days in one field state neither, and the weekday-less run
   inside "Saturday 5 December" was then read as a date beside Sunday: the
   listed dates were dropped as contradictions. */
describe("a listed date names its own day", () => {
  const facts = [
    fact("date", "Saturday 5 December"),
    fact("date", "Sunday 6 December"),
  ];
  it.each([
    "Saturday 5 December and Sunday 6 December",
    "Sat 5 Dec and Sun 6 Dec",
  ])("%j contradicts neither date", (subheadline) => {
    expect(
      contradictedDates(facts, design("Christmas market", subheadline)),
    ).toEqual([]);
  });
  it("5 December after no weekday still contradicts Saturday beside Sunday", () => {
    expect(
      contradictedDates(
        facts,
        design("Christmas market", "5 December and Sunday 6 December"),
      ),
    ).toEqual([expect.objectContaining({ run: "5 December" })]);
  });
});

/* Round-16 code critic, W28: "Su 5 December" stated "Saturday 5
   December". A two-letter weekday counts with its capital and a day of
   the month after it. */
describe("a two-letter weekday before a date", () => {
  const saturday = fact("date", "Saturday 5 December");
  it.each([
    ["Su 5 December", false],
    ["Su. 5 Dec", false],
    ["Sa 5 December", true],
    ["su 5 December", true],
    ["Market, 5 December · Su", true],
  ] as const)("%j states it: %s", (subheadline, stated) => {
    expect(factStated(saturday, design("Christmas market", subheadline))).toBe(
      stated,
    );
  });
});
