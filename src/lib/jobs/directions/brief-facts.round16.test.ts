import { describe, expect, it } from "vitest";
import { type CoverKind, factStated, needsFor } from "./brief-facts";

/*
 * Round-15 code critic, findings 1 to 3 (/tmp/feat-033/critique/
 * u3-code-verdict-round15.md; rows from r15-attack.mts and
 * r15-holdout.mts, labelled by the critic before any run). Each rule is
 * broad and fails closed, so the rows that must still stand are pinned
 * beside the ones it refuses.
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

/* Finding 1: a date run without its weekday is refused by any other
   weekday anywhere on the design; a year likewise. */
const DATE_ROWS: Row[] = [
  [
    "A1",
    "date",
    "Saturday 5 December",
    design("Brunch", "Sunday · Brunch · 5 December"),
    false,
  ],
  [
    "A2",
    "date",
    "Saturday 5 December",
    design("Brunch", "Sunday, 10am, 5 December"),
    false,
  ],
  [
    "A3",
    "date",
    "Saturday 5 December",
    design("Brunch", "5 December, 10am, Sunday"),
    false,
  ],
  [
    "A13",
    "date",
    "Saturday 5 December",
    design("Brunch", "Sundays' brunch, 5 December"),
    false,
  ],
  [
    "A27",
    "date",
    "Saturday 5 December",
    design("Brunch", "Sunday morning", ["5 December"]),
    false,
  ],
  [
    "A28",
    "date",
    "Saturday 5 December",
    design("Sunday brunch", "", ["5 December"]),
    false,
  ],
  [
    "K49",
    "date",
    "Saturday 6 December",
    design("We're back", "Sunday · 9am · 6 December"),
    false,
  ],
  [
    "K50",
    "date",
    "Saturday 6 December",
    design("We're back", "Sunday, 9am to 5pm, 6 December"),
    false,
  ],
  [
    "K55",
    "date",
    "Saturday 6 December",
    design("Sunday reopening", "6 December"),
    false,
  ],
  [
    "K56",
    "date",
    "Sunday 9 November",
    design("Saturday masterclass", "9 November, 2pm to 5pm"),
    false,
  ],
  [
    "year in another field",
    "date",
    "Saturday 5 December 2026",
    design("Since 2015", "Open 5 December"),
    false,
  ],
  [
    "button weekday",
    "date",
    "Saturday 5 December",
    design("Brunch", "Open 5 December", [], "Book for Sunday"),
    false,
  ],
  /* These stood in round 16 because each date carries its own weekday;
     two dated days in one field are now refused (Oluwaseyi's ruling,
     2026-10-28, field-wide rivals). */
  [
    "A14",
    "date",
    "Saturday 5 December",
    design("Brunch", "Saturday 5 December and Sunday 6 December"),
    false,
  ],
  [
    "A15",
    "date",
    "Sunday 6 December",
    design("Brunch", "Saturday 5 December and Sunday 6 December"),
    false,
  ],
  [
    "A21",
    "date",
    "Saturday 5 December",
    design("Brunch", "Saturday's market, 5 December"),
    true,
  ],
  [
    "A24",
    "date",
    "Saturday 5 December 2026",
    design("Brunch", "Saturday 5 December 2026"),
    true,
  ],
  [
    "A29",
    "date",
    "Saturday 5 December",
    design("Brunch", "Saturday 5 December and on Sunday 6 December"),
    false,
  ],
  [
    "own weekday elsewhere",
    "date",
    "Saturday 5 December",
    design("Saturday market", "5 December"),
    true,
  ],
  [
    "weekday in another field, own on the run",
    "date",
    "Saturday 5 December",
    design("Sunday brunch", "Saturday 5 December"),
    true,
  ],
  [
    "no weekday in the brief",
    "date",
    "1 November",
    design("Launch", "Friday 1 November"),
    true,
  ],
];

/* Finding 2: another value of the fact's kind beside the run, across any
   word or mark, or in the clause of a single value. */
const RIVAL_ROWS: Row[] = [
  ["B3", "time", "5pm", design("Open", "Open 9am ~ 5pm"), false],
  ["B4", "time", "5pm", design("Open", "Open 9am → 5pm"), false],
  ["B5", "time", "5pm", design("Open", "Open 9am 'til 5pm"), false],
  ["B6", "time", "5pm", design("Open", "Open 9am til 5pm"), false],
  ["B8", "time", "7pm", design("Doors", "Doors 6pm or 7pm"), false],
  ["B9", "time", "5pm", design("Open", "Open 9am…5pm"), false],
  [
    "K27",
    "time",
    "from 8am",
    design("Espresso flight", "Weekdays from 8am or 9am"),
    false,
  ],
  ["vs times", "time", "7pm", design("Doors", "6pm vs 7pm"), false],
  [
    "two times in a clause",
    "time",
    "7pm",
    design("Doors", "Doors 6pm and talks 7pm"),
    false,
  ],
  [
    "bare hour across a word",
    "time",
    "5pm",
    design("Open", "Open 9 til 5pm"),
    false,
  ],
  ["B23", "price", "₦4,500", design("Cake", "₦4,500 or ₦6,000"), false],
  [
    "K11",
    "price",
    "₦25,000",
    design("Valentine box", "₦20,000 or ₦25,000"),
    false,
  ],
  [
    "bare amount after or",
    "price",
    "₦4,500",
    design("Cake", "₦4,500 or 6,000"),
    false,
  ],
  ["B14", "date", "5 December", design("Market", "4, 5 December"), false],
  [
    "date or day after",
    "date",
    "5 December",
    design("Market", "5 December or 6"),
    false,
  ],
  [
    "date in a list without weekdays",
    "date",
    "5 December",
    design("Market", "4 December and 5 December"),
    false,
  ],
  ["B17", "quantity", "10 seats", design("Class", "One in 10 seats"), false],
  [
    "B29",
    "quantity",
    "10 seats",
    design("Class", "10 seats vs 20 seats"),
    false,
  ],
  [
    "count or bare",
    "quantity",
    "10 seats",
    design("Class", "10 seats or 12"),
    false,
  ],
  [
    "count tilde",
    "quantity",
    "10 seats",
    design("Class", "8 ~ 10 seats"),
    false,
  ],
  /* Every row below stood in round 16. Those now false are refused by
     Oluwaseyi's ruling of 2026-10-28 (any other value of the kind in the
     field, whatever joins it); those still true have no such value. */
  ["B18", "quantity", "10 seats", design("Class", "1 out of 10 seats"), false],
  [
    "B19",
    "quantity",
    "10 seats",
    design("Class", "10 seats in 2 rooms"),
    /* Round 18: a count of another noun or an age is not a count's
       rival. */
    true,
  ],
  ["B20", "quantity", "10 seats", design("Class", "Up to 10 seats"), true],
  [
    "B21",
    "quantity",
    "20 African countries",
    design("Send", "Send money in 20 African countries"),
    true,
  ],
  [
    "K12",
    "quantity",
    "20 African countries",
    design("Send money home", "1 app, 20 African countries"),
    /* Round 18: a count of another noun or an age is not a count's
       rival. */
    true,
  ],
  [
    "K45",
    "quantity",
    "10 seats",
    design("Pottery night", "10 seats, 18+"),
    /* Round 18: a count of another noun or an age is not a count's
       rival. */
    true,
  ],
  ["B35", "time", "4pm", design("Panel", "Panel at 4pm, doors 3pm"), false],
  [
    "K18",
    "time",
    "4pm",
    design("Building for Heat", "Doors 3pm, panel 4pm"),
    false,
  ],
  ["B36", "time", "4pm", design("Panel", "Panel 4pm and drinks after"), true],
  [
    "B25",
    "time",
    "9am to 5pm",
    design("Open", "Open 9am to 5pm and 6pm to 9pm"),
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
    "K26",
    "price",
    "₦6,000",
    design("Espresso flight", "Three shots, ₦6,000"),
    true,
  ],
  [
    "date then count",
    "date",
    "5 December",
    design("Market", "5 December, 12 stalls"),
    true,
  ],
  [
    "date then time",
    "date",
    "Friday 14 March",
    design("Heat", "Friday 14 March at 4pm"),
    true,
  ],
];

/* Finding 3: "N+ only" and "N and over only" are ages only after a
   clause's start or a word from the closed list. */
const AGE_ROWS: Row[] = [
  ["K44", "age", "18+", design("Pottery night", "Groups of 18+ only"), false],
  ["B32", "age", "18+", design("Night", "Sizes 18+ only"), false],
  ["B33", "age", "18+", design("Night", "Orders of 18+ only"), false],
  [
    "B34",
    "age",
    "ages 16 and up",
    design("Class", "Tables of 16 and over only"),
    false,
  ],
  ["18+ only", "age", "18+ only", design("Night", "18+ only"), true],
  [
    "Adults 18+ only",
    "age",
    "18+ only",
    design("Night", "Adults 18+ only"),
    true,
  ],
  ["Strictly", "age", "18+ only", design("Night", "Strictly 18+ only"), true],
  ["event is", "age", "18+", design("Night", "This event is 18+ only"), true],
  [
    "16 and over only",
    "age",
    "ages 16 and up",
    design("Class", "16 and over only"),
    true,
  ],
];

describe("round 16: a date without its weekday is refused by any other weekday on the design", () => {
  it.each(DATE_ROWS)("%s: %s %j", (_id, kind, text, copy, stated) => {
    expect(factStated(fact(kind, text), copy)).toBe(stated);
  });
});

describe("round 16: another value of the fact's kind beside a run refuses it", () => {
  it.each(RIVAL_ROWS)("%s: %s %j", (_id, kind, text, copy, stated) => {
    expect(factStated(fact(kind, text), copy)).toBe(stated);
  });
});

describe("round 16: 'N+ only' is an age only after a clause start or an age word", () => {
  it.each(AGE_ROWS)("%s: %s %j", (_id, kind, text, copy, stated) => {
    expect(factStated(fact(kind, text), copy)).toBe(stated);
  });
});
