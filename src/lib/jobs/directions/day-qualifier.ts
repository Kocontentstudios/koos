/**
 * The words that bound a day or a date: "from Monday", "until 12 December",
 * "by Friday", "Monday only", and the negation that turns it round ("Closed
 * on Monday").
 *
 * Round-10 live verdict, CB1: "available from Monday" was counted as
 * stated by "Your Monday treat is ready.", "Monday pickup", "pickup from
 * 7am on Monday", "Closed on Monday." and "Not available Monday.", because
 * a day fact needed only its weekday. A start, end or limit is part of the
 * fact, as "from" is part of a price (brief-facts, priceWithQualifier), so
 * a design states the fact only where the same bound stands at the same
 * day and nothing in that clause negates it. Fail closed: the fact writer
 * then writes the brief's own words in.
 */

export type DayBound = "from" | "until" | "by" | "only" | "after" | "before";

/* Directly before the day, or before "on", "this", "next", "coming" or
   "the" and the day. A word between ("from 7am on Monday") puts the bound
   on that word, not the day. "Out Monday" is a release: it is available
   from Monday (round-22 ruling). */
const BOUND_BEFORE =
  /\b(from|starting|starts?|beginning|begins?|as\s+of|effective|out|until|till|til|up\s+to|by|only|just|after|before)\s+(?:(?:on|this|next|coming|the)\s+)?$/i;
const BOUND_AFTER = /^\s*(onwards?|only)\b/i;

function boundOf(word: string): DayBound {
  const w = word.toLowerCase().replace(/\s+/g, " ");
  if (/^(?:until|till|til|up to)$/.test(w)) return "until";
  if (w === "by") return "by";
  if (/^(?:only|just)$/.test(w)) return "only";
  if (w === "after") return "after";
  if (w === "before") return "before";
  return "from";
}

/* An allow-list of the clause's polarity: a day said beside any of these
   is not the day the fact is for. */
const NEGATION =
  /\b(?:not|no|never|closed|except|excluding|unavailable)\b|n['’]t\b/i;

/* What ends the clause a day is said in. */
const CLAUSE_BREAK = /[.!?;:,·•\n—–(|]|\s-\s/;
const CLAUSE_BREAKS = new RegExp(CLAUSE_BREAK.source, "g");

const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
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
];

/* An abbreviation, and "May", only capitalised or in capitals: "sun",
   "sat", "wed", "mar" and "may" are words too. */
const ABBREVIATION =
  /^(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)$/;

/** The weekday or month a word names, as its first three letters, or null. */
function calendarName(word: string): string | null {
  const lower = word.toLowerCase();
  const singular = lower.replace(/s$/, "");
  if (WEEKDAYS.includes(lower) || WEEKDAYS.includes(singular)) {
    return singular.slice(0, 3);
  }
  if (MONTHS.includes(lower) && lower !== "may") return lower.slice(0, 3);
  const upperOrTitle = word === word.toUpperCase() || /^\p{Lu}/u.test(word);
  if (upperOrTitle && ABBREVIATION.test(titleCase(word))) {
    return lower.slice(0, 3);
  }
  return null;
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

const DAY_NUMBER = /^(?:[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?$/i;
const RUN_JOINER = /^(?:the|of)$/i;
/* Between two words of one date: spaces, a comma, or an abbreviation's
   full stop ("Sat. 12 Dec"). */
const RUN_GAP = /^\.?,?\s+$/;

export interface CalendarRun {
  start: number;
  end: number;
  /** The weekdays and months it names, as their first three letters. */
  names: Set<string>;
  bounds: Set<DayBound>;
  /** A negation word is in its clause. */
  negated: boolean;
}

/**
 * Every run of calendar words in `text` that names a weekday or month
 * ("Monday", "Saturday 12 December", "the 5th of May"), with the bounds
 * said at it and whether its clause negates it.
 */
export function calendarRuns(text: string): CalendarRun[] {
  const words = [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({
    word: m[0],
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    name: calendarName(m[0]),
  }));
  const runs: CalendarRun[] = [];
  let i = 0;
  while (i < words.length) {
    const inRun = (w: (typeof words)[number]) =>
      w.name !== null || DAY_NUMBER.test(w.word) || RUN_JOINER.test(w.word);
    if (!inRun(words[i])) {
      i += 1;
      continue;
    }
    let j = i;
    while (
      j + 1 < words.length &&
      inRun(words[j + 1]) &&
      RUN_GAP.test(text.slice(words[j].end, words[j + 1].start))
    ) {
      j += 1;
    }
    let from = i;
    let to = j;
    while (from <= to && RUN_JOINER.test(words[from].word)) from += 1;
    while (to >= from && RUN_JOINER.test(words[to].word)) to -= 1;
    const names = new Set(
      words
        .slice(from, to + 1)
        .map((w) => w.name)
        .filter((n): n is string => n !== null),
    );
    if (names.size > 0) {
      const start = words[from].start;
      const end = words[to].end;
      runs.push({
        start,
        end,
        names,
        bounds: boundsAt(text, start, end),
        negated: NEGATION.test(clauseAround(text, start, end)),
      });
    }
    i = j + 1;
  }
  return runs;
}

function boundsAt(text: string, start: number, end: number): Set<DayBound> {
  const bounds = new Set<DayBound>();
  const before = BOUND_BEFORE.exec(text.slice(Math.max(0, start - 40), start));
  if (before) bounds.add(boundOf(before[1]));
  const after = BOUND_AFTER.exec(text.slice(end, end + 20));
  if (after) bounds.add(after[1].toLowerCase() === "only" ? "only" : "from");
  return bounds;
}

/** The text of the clause a run sits in, the run itself left out. */
function clauseAround(text: string, start: number, end: number): string {
  let left = 0;
  for (const m of text.slice(0, start).matchAll(CLAUSE_BREAKS)) {
    left = (m.index ?? 0) + m[0].length;
  }
  const next = CLAUSE_BREAK.exec(text.slice(end));
  const right = next ? end + (next.index ?? 0) : text.length;
  return `${text.slice(left, start)} ${text.slice(end, right)}`;
}

const sameBounds = (a: Set<DayBound>, b: Set<DayBound>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

const shareAName = (a: CalendarRun, b: CalendarRun) =>
  [...a.names].some((n) => b.names.has(n));

/**
 * Whether `copy` says each day or date of the fact `fact` with the fact's
 * own bound and polarity. A fact's run with a bound needs a run in `copy`
 * naming the same day with exactly that bound; any run of the fact needs
 * its day said in `copy` in a clause negated as the fact's is. A run
 * `copy` never names is left to the fact's other needs, unless it carries
 * a bound, which then is missing.
 */
export function dayBoundKept(fact: string, copy: string): boolean {
  const said = calendarRuns(copy);
  return calendarRuns(fact).every((wanted) => {
    const same = said.filter((run) => shareAName(wanted, run));
    if (same.length === 0) return wanted.bounds.size === 0 && !wanted.negated;
    return same.some(
      (run) =>
        run.negated === wanted.negated &&
        (wanted.bounds.size === 0 || sameBounds(wanted.bounds, run.bounds)),
    );
  });
}

/** Where a day or date fact starts once the bound before it in the brief
 *  is taken in: "available from Monday" read as "Monday" is "from
 *  Monday". */
export function dayWithBound(brief: string, start: number): number {
  const before = BOUND_BEFORE.exec(brief.slice(Math.max(0, start - 40), start));
  return before ? start - before[0].length : start;
}
