import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DIRECTIONS_EVAL_CASES } from "@/lib/ai/design-directions/eval/cases";
import { READ_EVAL_CASES } from "@/lib/ai/design-directions/eval/read-cases";
import type { CopyToken } from "@/lib/design/copy-tokens";
import {
  type BriefFact,
  type CoverKind,
  factStated,
  needsFor,
} from "./brief-facts";
import { formTokensOf, numberFactOf } from "./fact-forms";

/*
 * Round-11 code critic, break 1: a fact with several numbers was given
 * forms for one of them, so copy stating that one part stated the whole
 * fact ("5 December" for "5, 12 and 19 December"). The property: every
 * form of every number fact carries each of the fact's numbers, times,
 * amounts and calendar names. Two parts may be left out by rule, and only
 * these: a single date's weekday and year (the field may not contradict
 * them) and the size in a price's unit (round-6 live run).
 *
 * The parts are read here independently of fact-forms.ts's own check, so a
 * part that check forgets fails this test.
 */

const NUMBER_KINDS: CoverKind[] = [
  "age",
  "date",
  "quantity",
  "price",
  "time",
  "place",
];

const fact = (kind: CoverKind, text: string): BriefFact => ({
  kind,
  text,
  needs: needsFor(kind, text),
});

const WEEKDAYS = new Set(
  [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ].map((d) => `w:~${d}`),
);
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
].map((m) => `w:~${m}`);
const SIZE_WORD =
  /^(?:ml|cl|l|litres?|liters?|kg|g|grams?|cm|mm|inch(?:es)?|oz)$/i;

const isNum = (t: CopyToken | undefined) => t?.kind === "number";
const isYear = (t: CopyToken) =>
  isNum(t) && (t.value ?? 0) >= 1900 && (t.value ?? 0) <= 2100;

/** What in a form says the fact's token `t`. */
function carries(kind: CoverKind, facts: CopyToken[], t: CopyToken) {
  const numericDate =
    kind === "date" &&
    facts.some((x, i) => x.key === "/" && isNum(facts[i - 1]));
  return (c: CopyToken) => {
    if (c.key === t.key) return true;
    const day = (x: CopyToken) => x.key.replace(/s$/, "");
    if (t.kind === "word" && c.kind === "word" && day(c) === day(t)) {
      return true;
    }
    if (/^w:(?:daily|everyday)$/.test(t.key)) {
      return /^w:(?:daily|everyday|day)$/.test(c.key);
    }
    const hour = (m: number) => Math.floor(m / 60) % 12;
    if (t.kind === "number" && kind === "time" && c.kind === "clock") {
      return (
        (c.value ?? 0) % 60 === 0 && hour(c.value ?? 0) === (t.value ?? 0) % 12
      );
    }
    if (t.kind === "clock" && c.kind === "number") {
      return (
        (t.value ?? 0) % 60 === 0 && (c.value ?? 0) % 12 === hour(t.value ?? 0)
      );
    }
    if (t.kind === "number" && numericDate) {
      return c.key === MONTHS[(t.value ?? 0) - 1];
    }
    return false;
  };
}

/** The fact's parts every form must hold. */
function partsOf(kind: CoverKind, text: string): CopyToken[] {
  const tokens = formTokensOf(text);
  const dated = kind === "date" && tokens.some((t) => MONTHS.includes(t.key));
  return tokens.filter((t, i) => {
    if (kind === "date" && isYear(t)) return false;
    if (dated && WEEKDAYS.has(t.key)) return false;
    if (kind === "price" && isNum(t)) {
      const next = tokens[i + 1]?.key === "-" ? tokens[i + 2] : tokens[i + 1];
      if (next?.kind === "word" && SIZE_WORD.test(next.text)) return false;
    }
    return (
      t.kind === "number" ||
      t.kind === "clock" ||
      t.kind === "money" ||
      WEEKDAYS.has(t.key) ||
      MONTHS.includes(t.key) ||
      (kind === "time" && DAY_WORDS.test(t.text))
    );
  });
}

/* The words that say which days a time is for. */
const DAY_WORDS =
  /^(?:weekdays?|weekends?|daily|everyday|nightly|(?:mon|tues|wednes|thurs|fri|satur|sun)days)$/i;

function partialForms(kind: CoverKind, text: string): string[] {
  const made = numberFactOf(fact(kind, text));
  if (!made) return [];
  const tokens = formTokensOf(text);
  const parts = partsOf(kind, text);
  return made.forms
    .filter((form) =>
      parts.some((p) => !form.tokens.some((c) => carries(kind, tokens, p)(c))),
    )
    .map((form) => form.text);
}

/* The facts of the acceptance and holdout sets and of every job test's
   brief, read from their sources so no fact is retyped or left out. */
const ROW =
  /\[\s*"[^"]+",\s*"(age|date|quantity|price|time|place)",\s*("(?:[^"\\]|\\.)*")/g;
const READ =
  /kind: "(age|date|quantity|price|time|place)",\s*text: ("(?:[^"\\]|\\.)*")/g;

function factsIn(file: string, pattern: RegExp): [CoverKind, string][] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(pattern)].map((m) => [
    m[1] as CoverKind,
    JSON.parse(m[2]) as string,
  ]);
}

const here = join(process.cwd(), "src/lib/jobs/directions");
const jobs = join(process.cwd(), "src/lib/jobs");
const testFiles = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".test.ts"))
    .map((f) => join(dir, f));

const SET_FACTS: [CoverKind, string][] = [
  ...factsIn(join(here, "brief-facts.acceptance.test.ts"), ROW),
  ...factsIn(join(here, "brief-facts.holdout.test.ts"), ROW),
  ...[...testFiles(jobs), ...testFiles(here)].flatMap((f) => factsIn(f, READ)),
];

/* Every labelled fact of the eval cases, under every kind a number fact
   can be read as. */
const EVAL_FACTS: [CoverKind, string][] = [
  ...DIRECTIONS_EVAL_CASES.flatMap((c) => c.facts),
  ...READ_EVAL_CASES.flatMap((c) => c.facts),
].flatMap(({ text }) =>
  NUMBER_KINDS.map((k): [CoverKind, string] => [k, text]),
);

/* Multi-part facts, generated: lists and ranges of dates, times, ages,
   counts and prices, joined every way a brief joins them. */
function generated(): [CoverKind, string][] {
  const out: [CoverKind, string][] = [];
  const joins = [", ", " and ", " & ", " or ", ", then "];
  const months = ["December", "January", "May"];
  const days = ["Saturday", "Sunday"];
  for (const j of joins) {
    for (const m of months) {
      out.push(
        ["date", `5${j}12 ${m}`],
        ["date", `5, 12${j}19 ${m}`],
        ["date", `${days[0]} 5${j}${days[1]} 6 ${m}`],
        ["date", `5 ${m}${j}9 ${months[(months.indexOf(m) + 1) % 3]}`],
        ["date", `${days[0]} 5 ${m}${j}7pm`],
        ["date", `5 ${m} 2026${j}6 ${m} 2026`],
      );
    }
    out.push(
      ["time", `9am${j}12pm${j}3pm`],
      ["time", `Mon-Fri 9am-5pm${j}Sat 10am-2pm`],
      ["time", `8am-2pm${j}4pm-10pm`],
      ["time", `Doors 6pm${j}show 7pm`],
      ["time", `6pm${j}8pm`],
      ["time", `9-5 weekdays${j}10-2 Saturdays`],
      ["time", `Saturday${j}Sunday 10am-4pm`],
      ["age", `Ages 5-12${j}13-17`],
      ["age", `5+${j}12+`],
      ["age", `kids 5 to 8${j}9 to 12`],
      ["age", `under 5s free${j}5+ ₦2,000`],
      ["quantity", `12 stalls${j}5 food trucks`],
      ["quantity", `2${j}3 bedroom flats`],
      ["price", `₦4,500 a slice${j}₦30,000 a cake`],
      ["price", `₦6,500 a yard${j}₦38,000 for 5 yards`],
      ["place", `Plot 5${j}Block 12, Admiralty Way`],
    );
  }
  return out;
}

const ALL = [
  ...new Map(
    [...SET_FACTS, ...EVAL_FACTS, ...generated()].map((f) => [f.join("|"), f]),
  ).values(),
];

describe("every form carries the whole fact", () => {
  it("reads the facts of every set and job test", () => {
    expect(SET_FACTS.length).toBeGreaterThan(400);
    expect(EVAL_FACTS.length).toBeGreaterThan(300);
    expect(SET_FACTS.some(([, text]) => text === "5, 12 and 19 December")).toBe(
      true,
    );
  });

  it.each(ALL)("%s %j", (kind, text) => {
    expect(partialForms(kind, text)).toEqual([]);
  });

  /* The fact writer writes a missing fact in the brief's own words; those
     words must state it, or the writer is asked for what it already did. */
  it.each([...SET_FACTS, ...generated()].filter(([kind]) => kind !== "place"))(
    "%s %j states itself",
    (kind, text) => {
      expect(
        factStated(fact(kind, text), { headline: text, footerLines: [] }),
      ).toBe(true);
    },
  );
});

/* The fact's needs (=5, @1140, ~dec) were a second check at 88d3ea1, and
   round 11 dropped it for number facts. It is subsumed: every need names a
   part of the fact (this test), and every form carries every part (the
   test above), so copy that holds a form holds every need. A date's
   weekday and year are the parts its forms may leave out. */
describe("a number fact's needs are among its parts", () => {
  /** The fact's token a need names, or undefined. The needs are read by
   *  regex (needsFor) and the parts by token, so a need names a token by
   *  value: "=4" the clock 4pm, "@720" the 12 of "12-6pm", "~nov" the 11
   *  of "3/11", "=2.5" the amount "₦2.5m". */
  const tokenFor = (tokens: CopyToken[], need: string) => {
    const value = need.slice(1);
    const n = Number(value);
    const hour = (m: number) => Math.floor(m / 60) % 12;
    if (need.startsWith("@")) {
      return tokens.find(
        (t) =>
          (t.kind === "clock" && t.value === n) ||
          (isNum(t) && n % 60 === 0 && (t.value ?? 0) % 12 === hour(n)),
      );
    }
    if (need.startsWith("=")) {
      return tokens.find(
        (t) =>
          ((t.kind === "number" || t.kind === "money") && t.value === n) ||
          (t.kind === "money" && t.text.replace(/,/g, "").includes(value)) ||
          (t.kind === "clock" &&
            (t.value ?? 0) % 60 === 0 &&
            hour(t.value ?? 0) === n % 12),
      );
    }
    const month = MONTHS.findIndex((m) => m.startsWith(`w:~${value}`));
    return tokens.find(
      (t) =>
        t.key.startsWith(`w:~${value}`) ||
        (t.kind === "word" && t.key.startsWith(`w:${value}`)) ||
        (month >= 0 && isNum(t) && t.value === month + 1),
    );
  };

  it.each(ALL.filter(([kind]) => kind !== "place"))("%s %j", (kind, text) => {
    const f = fact(kind, text);
    if (!numberFactOf(f)) return;
    const tokens = formTokensOf(text);
    const own = new Set(partsOf(kind, text).map((t) => t.key));
    const dated = kind === "date" && tokens.some((t) => MONTHS.includes(t.key));
    const notParts = f.needs
      .filter((n) => /^[=@~]/.test(n))
      .filter((n) => {
        const t = tokenFor(tokens, n);
        if (!t) return true;
        if (kind === "date" && (isYear(t) || (dated && WEEKDAYS.has(t.key)))) {
          return false;
        }
        return !own.has(t.key);
      });
    expect(notParts).toEqual([]);
  });
});
