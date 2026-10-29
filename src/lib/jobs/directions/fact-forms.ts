import {
  type CopyToken,
  endsClause,
  isNumeric,
  joinsNumbers,
  runsOf,
  tokensOf,
  WEEKDAY_NAMES,
  withoutEdgeMarks,
} from "@/lib/design/copy-tokens";

/**
 * The ways a design may write a brief fact that holds a number, generated
 * from the fact, and nothing else (Oluwaseyi's ruling, 2026-10-28).
 *
 * Rounds 7 to 10 read a number's meaning off its nearest word and carved
 * out exceptions as critics found them; every unlisted separator or noun
 * failed open. Here a fact is stated only when one of its forms is a
 * contiguous run of tokens in one field, so an unseen separator or noun can
 * only refuse correct copy, never pass wrong copy. What is refused, the
 * fact writer (the model) writes in. Code never writes copy: a form is only
 * what the verifier accepts.
 *
 * Every form carries the whole fact: each of its numbers, times, amounts
 * and calendar names (wholeForms). A form for one part of a fact ("5
 * December" of "5, 12 and 19 December") stated the whole fact wherever
 * that part stood (round-11 code critic, break 1). A fact no generator can
 * write whole keeps its own words as its one form. Two parts may be left
 * out, because they name the day the rest already names: a date's
 * weekdays and years once it names its month. Neither may then be
 * contradicted in the date's clause or by a clause beside it that is only a
 * weekday or a year ("Sunday · 5 December", "5 December 2025").
 *
 * A weekday or month is matched in any of its spellings ("Saturday",
 * "Sat", "Sat."), a number in digits or words ("8", "eight", "5th"), a
 * clock time by its minutes ("7pm", "19:00") and an amount by its currency
 * and value ("₦4,500", "N4500", "4,500 naira"); the forms are written once
 * in full.
 */

interface Around {
  run: readonly CopyToken[];
  before: CopyToken | undefined;
  beforeThat: CopyToken | undefined;
  after: CopyToken | undefined;
  afterThat: CopyToken | undefined;
  /** Every token after the run, in its item. */
  following: readonly CopyToken[];
  /** Every token before the run, in its item, nearest first. */
  preceding: readonly CopyToken[];
  /** The whole field the run stands in: a footer item's whole line. */
  field: readonly CopyToken[];
  /** Where the run starts in `field`, or -1 when it cannot be placed. */
  at: number;
  /** Every field the design draws, `field` among them. */
  design: readonly (readonly CopyToken[])[];
}

/** Whether the tokens around a run let it stand as the fact. */
type Guard = (around: Around) => boolean;

export interface FactForm {
  /** The form as text, for tests and logs. */
  text: string;
  tokens: CopyToken[];
  guard: Guard | null;
  /** The fact's kind, which says what another number beside it is
   *  (rivalled). */
  kind?: string;
  /** For a price: what it buys, and the brief's other prices with what
   *  each buys, so a price list is not read as a choice (pricedApart). */
  priced?: PricedItems;
}

/** A price's own item words and the brief's other priced items. */
export interface PricedItems {
  own: ReadonlySet<string>;
  others: readonly { amount: string; words: ReadonlySet<string> }[];
}

export interface NumberFact {
  forms: FactForm[];
  /** What else the field must say: a place's street and area words. */
  alsoNeeds: string[];
  /** A date's weekdays and years, which no field may contradict. */
  date?: DateFact;
}

const OPEN = null;

const MONTHS = [
  ["january", "jan"],
  ["february", "feb"],
  ["march", "mar"],
  ["april", "apr"],
  ["may"],
  ["june", "jun"],
  ["july", "jul"],
  ["august", "aug"],
  ["september", "sep", "sept"],
  ["october", "oct"],
  ["november", "nov"],
  ["december", "dec"],
];
/** needsFor's month names ("~dec"), in order. */
export const MONTH_KEYS = MONTHS.map((names) => names[1] ?? names[0]);

const CALENDAR = new Map<string, { key: string; short: boolean }>();
for (const names of [...WEEKDAY_NAMES, ...MONTHS]) {
  for (const [i, name] of names.entries()) {
    CALENDAR.set(name, { key: `w:~${names[0]}`, short: i > 0 });
  }
}

/* "may" is a month only written as one, with a capital: "Kids under 5 may
   attend" is not 5 May (round-11 code critic, D1). */
const isLowercaseMay = (t: CopyToken) => t.text === "may";

/** `tokens` with every weekday and month in one spelling, and the full
 *  stop after an abbreviated one ("Sat.") taken as part of it. */
function withCalendarNames(tokens: readonly CopyToken[]): CopyToken[] {
  const out: CopyToken[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    const name =
      t.kind === "word" && !isLowercaseMay(t)
        ? CALENDAR.get(t.key.slice(2))
        : undefined;
    if (!name) {
      out.push(t);
      continue;
    }
    out.push({ ...t, key: name.key });
    if (
      name.short &&
      tokens[i + 1]?.key === "." &&
      continuesDate(tokens[i + 2])
    ) {
      i += 1;
    }
  }
  return out;
}

/* The full stop of "Sat. 5 Dec." is the abbreviation's when a date goes
   on after it; before anything else it also ends the sentence: "Sat 5
   Dec. Book now" ends its date where the renderer reads a break
   (round-12 acceptance, the renderer's repeat rule). */
function continuesDate(t: CopyToken | undefined): boolean {
  return (
    isNumeric(t) ||
    (t?.kind === "word" && !isLowercaseMay(t) && CALENDAR.has(t.key.slice(2)))
  );
}

/** `text` as the forms read it: "2 hrs" is "2 hours", "Sat" is
 *  "Saturday". */
export function formTokensOf(text: string): CopyToken[] {
  return withCalendarNames(tokensOf(meaningOf(text)));
}

function form(text: string, guard: Guard | null = OPEN): FactForm {
  return { text, tokens: formTokensOf(text), guard };
}

const word = (t: CopyToken | undefined, ...words: string[]) =>
  t?.kind === "word" && words.includes(t.key.slice(2));

const isNumber = (t: CopyToken | undefined) => t?.kind === "number";
const isYear = (t: CopyToken | undefined) =>
  isNumber(t) && (t?.value ?? 0) >= 1900 && (t?.value ?? 0) <= 2100;
const isDayNumber = (t: CopyToken | undefined) =>
  isNumber(t) && !isYear(t) && (t?.value ?? 0) >= 1 && (t?.value ?? 0) <= 31;
const weekdayOf = (t: CopyToken | undefined) =>
  t?.kind === "word" && WEEKDAY_NAMES.some((d) => t.key === `w:~${d[0]}`)
    ? t.key
    : null;
const monthOf = (t: CopyToken | undefined) =>
  t?.kind === "word" && MONTHS.some((m) => t.key === `w:~${m[0]}`)
    ? t.key
    : null;
/* A month's name with its capital, so the form reads "May" as a month. */
const nameOf = (key: string) => key.charAt(3).toUpperCase() + key.slice(4);

/* A clause starts at a field's start or after a breaking mark, but a colon
   after a word labels what follows with that word: "Flavours: 18+" counts
   flavours (round-9 code critic). */
function startsClause({ before, beforeThat }: Around): boolean {
  if (before === undefined) return true;
  if (!before.breaks) return false;
  return !(before.key === ":" && beforeThat?.kind === "word");
}

/* A number with no word of its own ("20") stands only alone in its
   clause. */
const alone: Guard = (around) =>
  startsClause(around) && endsClause(around.after);

/* What may follow an age: a clause's end, or a word from this closed list,
   none of which can be what a number counts. "18+ to choose from" and
   "all ages 8+ flavours" are counts (round-11 code critic, A1 to A5), so
   "to" stands only before a verb an age is for, and one that cannot take
   what a number counts: "18+ to take home" counts things to take
   (round-12 code critic, G6). */
const AGE_TAIL = [
  "only",
  "welcome",
  "please",
  "strictly",
  "at",
  "this",
  "every",
  "event",
  "party",
  "night",
  "entry",
  "admission",
];
const AGE_VERBS = [
  "enter",
  "attend",
  "join",
  "register",
  "apply",
  "participate",
  "sign",
];
/* A plural noun after a number can be what it counts: "Just 18+ nights
   left" is eighteen nights (round-12 code critic, G1). After "for" it is
   who the nights are for: "For 18+ nights only" (round-11, A6). */
const AGE_PLURALS = ["nights", "events"];

/* "and" then another age band ("Ages 5-12 and 13-17", "5+ and 12+"),
   ending where an age ends; "18+ and 2 days to go" counts days (round-12
   code critic, G4 and G5). */
function andAnotherBand(following: readonly CopyToken[]): boolean {
  const [and, n, mark, m] = following;
  if (!word(and, "and") || !isNumber(n)) return false;
  if (mark?.key === "+") return ageTailAt(following, 3);
  const ranged =
    (mark?.key === "-" || word(mark, "to")) && isNumber(m) && m !== undefined;
  return ranged && ageTailAt(following, 4);
}
const ageTailAt = (following: readonly CopyToken[], i: number) =>
  endsClause(following[i]) || word(following[i], ...AGE_TAIL);

const ageEnds: Guard = ({ before, after, afterThat, following }) =>
  endsClause(after) ||
  word(after, ...AGE_TAIL) ||
  (word(after, ...AGE_PLURALS) && word(before, "for")) ||
  (word(after, "to") && word(afterThat, ...AGE_VERBS)) ||
  andAnotherBand(following);
/* A bare age ("18+", "21 and over") also needs what comes before to make
   it an age: a clause's start or a word that introduces one ("Must be 18+
   to enter", "Strictly 18+"). "Over 18+ flavours" is a count (round-8 and
   round-10 code critic, N2 and B7). */
const AGE_LEAD = ["be", "strictly", "only", "for", "just"];
const bareAge: Guard = (around) =>
  (startsClause(around) ||
    word(around.before, ...AGE_LEAD) ||
    /* "Open to 16 and over" (round-12 critic holdout, F39). */
    (word(around.before, "to") && word(around.beforeThat, "open"))) &&
  ageEnds(around);

/* "18+ only" is an age after a clause's start or a word from this closed
   list. After any other word it may be a minimum of something else:
   "Groups of 18+ only", "Sizes 18+ only", "Tables of 16 and over only"
   (round-15 code critic, finding 3). */
const ONLY_AGE_LEAD = [
  "is",
  "are",
  "be",
  "for",
  "ages",
  "aged",
  "adults",
  "strictly",
  "event",
  "class",
  "session",
];
const onlyAge: Guard = (around) =>
  startsClause(around) || word(around.before, ...ONLY_AGE_LEAD);

/* The words that name an age: a form led by one is an age, before a clause
   end or a word from the age's closed list. */
const AGE_WORDS = ["ages", "aged", "age", "adults", "kids", "children"];
const AND_UP = ["and up", "and over", "and above", "and older"];

function ageForms(tokens: CopyToken[], own: string): FactForm[] | null {
  const anchored = tokens.some((t) => word(t, ...AGE_WORDS));
  const numbers = tokens
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => isNumber(t));
  if (numbers.length === 0 || numbers.length > 2) return null;
  /* "Age: 18+" labels an age; "all ages: 8+ flavours" counts flavours
     (round-9 code critic, FP2), so a labelled age ends where a bare one
     does, and so does one its age word leads (round-11, A4). */
  const led = (span: string) =>
    AGE_WORDS.flatMap((w) => [
      form(`${w} ${span}`, ageEnds),
      form(`${w}: ${span}`, ageEnds),
    ]);
  const forms: FactForm[] = [];
  const [first, second] = numbers;
  if (second) {
    const between = tokens.slice(first.i + 1, second.i).map((t) => t.key);
    if (between.join() !== "-" && between.join() !== "w:to") return null;
    const spans = [
      `${first.t.text}-${second.t.text}`,
      `${first.t.text} to ${second.t.text}`,
    ];
    for (const span of spans) forms.push(...led(span));
    /* A range with no word of its own keeps its own form only, never any
       range: "Runs 5-12 December" is not the ages 5-12 (round-10 code
       critic, B11). */
    if (!anchored) for (const span of spans) forms.push(form(span, bareAge));
    return forms;
  }
  const after = tokens
    .slice(first.i + 1, first.i + 3)
    .map((t) => t.key.replace(/^w:/, ""));
  const plus =
    after[0] === "+" ||
    [...AND_UP, "or over", "or older"].includes(after.join(" "));
  if (!plus) return [form(own, anchored ? ageEnds : bareAge)];
  const n = first.t.text;
  const ups = [`${n}+`, ...AND_UP.map((p) => `${n} ${p}`)];
  for (const up of ups) forms.push(...led(up));
  forms.push(form(`${n}+ only`, onlyAge), form(`${n} and over only`, onlyAge));
  const spelledOut = [...ups.slice(1), `${n} or over`, `${n} or older`];
  /* An age with its word ("ages 16 and up") is said whole by "16+ only"
     or "16 and over", which are ages wherever bareAge stands them (round-12
     critic holdout, F38 and F39). A bare "16+" is not: "all ages · 8+"
     may count flavours (round-11 code critic, U rows). */
  for (const up of anchored ? spelledOut : [ups[0], ...spelledOut]) {
    forms.push(form(up, bareAge));
  }
  return forms;
}

/* What may follow a date, from a closed list. After a day ("5 December")
   the number is behind the month and counts nothing, so a word that
   starts the next phrase may follow ("5 December in Lekki"); after a
   month and day ("December 5") only a word that cannot be counted may:
   "December 5 in stock" and "December 5 stalls" are counts (round-10 and
   round-11 code critic, DT9, DT13 and D3). A year, a time and a clause's
   end follow either; an ordinal ("5th") is always a day. */
const DATE_TAIL = ["at", "from", "till", "until", "onwards", "only"];
const DAY_FIRST_TAIL = [...DATE_TAIL, "in", "on", "for", "with", "and"];

interface DateFact {
  weekdays: ReadonlySet<string>;
  years: ReadonlySet<number>;
}

/* A weekday as a reader takes one: its full name in any case, or a short
   one with its capital ("Sun", "SAT"), and either possessive or plural
   ("Sunday's market", "Sundays"). "Fun in the sun" names no day (round-12
   code critic, D2); "Sunday's market, 5 December" names Sunday (round-14
   code critic, DS8). The tokenizer ends a word before a trailing
   apostrophe, so "Sundays' brunch" reads "Sundays" (round-15, A13). */
function readsAsWeekday(t: CopyToken | undefined): string | null {
  if (t?.kind !== "word") return null;
  const day = weekdayOf(t);
  if (day) {
    const full = day.slice(3) === t.text.toLowerCase();
    return full || /^\p{Lu}/u.test(t.text) ? day : null;
  }
  const base = t.text.toLowerCase().replace(/(?:['’]s|s)$/, "");
  return WEEKDAY_NAMES.some((d) => d[0] === base) ? `w:~${base}` : null;
}

/* A two-letter weekday ("Su 5 December", "Sa. 5 Dec") is one only with
   its capital and a day of the month after it: "We 3 are open" is not
   Wednesday, "Su" alone is nothing (round-16 code critic, W28). */
const TWO_LETTER_DAYS = new Map(
  WEEKDAY_NAMES.map((d) => [d[0].slice(0, 2), `w:~${d[0]}`]),
);
function readsAsWeekdayAt(
  tokens: readonly CopyToken[],
  i: number,
): string | null {
  const t = tokens[i];
  const day = readsAsWeekday(t);
  if (day || t?.kind !== "word" || !/^\p{Lu}\p{Ll}$/u.test(t.text)) {
    return day;
  }
  const next = tokens[i + 1]?.key === "." ? tokens[i + 2] : tokens[i + 1];
  return isDayNumber(next)
    ? (TWO_LETTER_DAYS.get(t.text.toLowerCase()) ?? null)
    : null;
}

/* What may follow a year: a clause's end, a number or time, or one of
   these. "2,000 builders" and "2025 recap" are a count and a name, not
   years (round-12 code critic, D7). */
const YEAR_TAIL = ["at", "from", "till", "until", "to", "onwards", "and"];

/* A year as a reader takes one: four digits with no comma, from 1900 to
   2100, not followed by a word that could be what it counts or names. */
function readsAsYear(tokens: readonly CopyToken[], i: number): boolean {
  const t = tokens[i];
  if (!isYear(t) || !/^\d{4}$/.test(t.text)) return false;
  const next = tokens[i + 1];
  return next?.kind !== "word" || word(next, ...YEAR_TAIL);
}

/* The bounds of the clause holding tokens[from, to): from the breaking
   mark before it to the one after it. */
function clauseAround(
  tokens: readonly CopyToken[],
  from: number,
  to: number,
): [number, number] {
  let start = from;
  while (start > 0 && !tokens[start - 1].breaks) start -= 1;
  let stop = to;
  while (stop < tokens.length && !tokens[stop].breaks) stop += 1;
  return [start, stop];
}

/* What a date in a list may hold besides its weekday: "Saturday 5 and
   Sunday 6 December", "Friday the 4th of December". */
const isDatePart = (t: CopyToken | undefined) =>
  isDayNumber(t) || monthOf(t) !== null || isYear(t) || word(t, "the", "of");

/* The weekday of another date joined to the run by "and": in "Saturday 5
   December and Sunday 6 December" Sunday is 6 December's, so it does not
   contradict 5 December's Saturday (round-14 code critic, J30). Only a
   weekday that starts the other date and stands right beside the "and" is
   taken: anything looser could be the run's own. */
function listedWeekdays(
  field: readonly CopyToken[],
  at: number,
  end: number,
): Set<number> {
  const listed = new Set<number>();
  const and = (t: CopyToken | undefined) => word(t, "and");
  let next = end;
  if (and(field[next])) {
    next += 1;
    if (word(field[next], "on")) next += 1;
    if (readsAsWeekday(field[next]) && isDatePart(field[next + 1])) {
      listed.add(next);
    }
  }
  if (and(field[at - 1])) {
    let i = at - 2;
    while (i >= 0 && isDatePart(field[i])) i -= 1;
    if (i < at - 2 && readsAsWeekday(field[i])) listed.add(i);
  }
  return listed;
}

/* A date's weekday and year may be left out, never contradicted. A run
   that carries its weekday is read against its own clause: another weekday
   there refuses it, unless it is another listed date's own ("Saturday 5
   December and Sunday 6 December", listedWeekdays), so a weekday two
   clauses off still stands ("Friday 14 March · Saturday workshops",
   round-12 code critic, D6 to D9 and F68). A run that leaves its weekday
   out is refused by any other weekday anywhere on the design: rounds 13
   to 15 scoped that to a clause, then to the clauses beside it, and each
   critic found the next weekday one clause further off ("Sunday, 10am, 5
   December") or in another field (headline "Sunday brunch" over a footer
   "5 December"), round-15 code critic, finding 1. A wrong "stated" ships
   the wrong day while the job reports it delivered; a wrong "not stated"
   costs a fact-writer rewrite, which writes the weekday in. A year works
   the same way. A date given with no weekday stands beside any: "Friday 1
   November" states "1 November" (eval a at 5d49a60, fashion and
   masterclass). */
function contradicted({ weekdays, years }: DateFact, around: Around): boolean {
  const { run, field, at, design } = around;
  const otherDay = (tokens: readonly CopyToken[], i: number) => {
    const day = readsAsWeekdayAt(tokens, i);
    return Boolean(day && weekdays.size > 0 && !weekdays.has(day));
  };
  const otherYear = (tokens: readonly CopyToken[], i: number) =>
    years.size > 0 &&
    readsAsYear(tokens, i) &&
    !years.has(tokens[i].value ?? 0);
  const end = at + run.length;
  /* "5 December" inside "Saturday 5 December" is the run that names its
     day: read as the longer form, it is not a weekday-less date beside
     another weekday (J30: two dated days in one field state neither, and
     the shorter run was then taken for a contradiction). */
  const ownDayBefore =
    at > 0 && weekdays.has(readsAsWeekday(field[at - 1]) ?? "");
  const saysDay = ownDayBefore || run.some((t) => weekdayOf(t) !== null);
  /* The forms leave a year out and dateGuard lets one follow, so the
     fact's own year right after the run is the date's: "Saturday 5
     December 2026" carries its year (round-12 code critic, D6). */
  const yearAt = field[end]?.key === "/" ? end + 1 : end;
  const ownYearAfter =
    at >= 0 &&
    readsAsYear(field, yearAt) &&
    years.has(field[yearAt].value ?? 0);
  const saysYear = run.some(isYear) || ownYearAfter;
  const anywhere = (
    test: (tokens: readonly CopyToken[], i: number) => boolean,
  ) =>
    [field, ...design].some((tokens) => tokens.some((_, i) => test(tokens, i)));
  if (!saysDay && anywhere(otherDay)) return true;
  if (!saysYear && anywhere(otherYear)) return true;
  /* A run that cannot be placed in its field is read against all of it,
     as before: refusing more, never less. */
  if (at < 0) {
    return field.some((_, i) => otherDay(field, i) || otherYear(field, i));
  }
  const start = ownDayBefore ? at - 1 : at;
  const [from, to] = clauseAround(field, start, end);
  const listed = saysDay
    ? listedWeekdays(field, start, end)
    : new Set<number>();
  for (let i = from; i < to; i += 1) {
    if ((otherDay(field, i) && !listed.has(i)) || otherYear(field, i)) {
      return true;
    }
  }
  return false;
}

function dateGuard(fact: DateFact, tail: readonly string[]): Guard {
  return (around) => {
    const { run, before, after, afterThat } = around;
    if (contradicted(fact, around)) return false;
    /* "12 5 December", "12/5 December": a number before it makes the
       month the other number's. */
    if (isNumber(before) || before?.kind === "clock") return false;
    if (run.find(isNumber)?.ordinal) return true;
    return (
      endsClause(after) ||
      isYear(after) ||
      (after?.key === "/" && isYear(afterThat)) ||
      after?.kind === "clock" ||
      word(after, ...tail)
    );
  };
}

/* A form that holds the weekday, or reads "the 5th of", is a date
   wherever it stands, unless the field contradicts it. */
const uncontradicted =
  (fact: DateFact): Guard =>
  (around) =>
    !contradicted(fact, around);

const ordinalDay =
  (fact: DateFact): Guard =>
  (around) =>
    !contradicted(fact, around) && Boolean(around.run.find(isNumber)?.ordinal);

interface DateEnd {
  weekday: string | null;
  day: string | null;
  month: string | null;
}

/* One end of a date, or null when the tokens hold more than one day,
   month or weekday: "5, 12 and 19 December" and "Saturday 5 and Sunday 6
   December" are lists no single-date form can write whole. */
function dateEndOf(tokens: readonly CopyToken[]): DateEnd | null {
  const days = tokens.filter(isDayNumber);
  const months = tokens.map(monthOf).filter(Boolean);
  const weekdays = tokens.map(weekdayOf).filter(Boolean);
  const others = tokens.filter(
    (t) => isNumeric(t) && !isDayNumber(t) && !isYear(t),
  );
  if (days.length > 1 || months.length > 1 || weekdays.length > 1) {
    return null;
  }
  if (others.length > 0) return null;
  return {
    weekday: weekdays[0] ?? null,
    day: days[0] ? String(days[0].value) : null,
    month: months[0] ?? null,
  };
}

const TO = ["-", "w:to", "w:till", "w:until", "w:through"];

/* "Friday 12 December to Sunday 14 December", "5-7 December": the two ends
   of a range, the first taking the second's month when it has none. */
function dateEndsOf(tokens: readonly CopyToken[]): DateEnd[] | null {
  const split = tokens.findIndex(
    (t, i) =>
      TO.includes(t.key) &&
      tokens.slice(0, i).some(isNumber) &&
      tokens.slice(i + 1).some(isNumber),
  );
  if (split < 0) {
    const single = dateEndOf(tokens);
    return single ? [single] : null;
  }
  const start = dateEndOf(tokens.slice(0, split));
  const end = dateEndOf(tokens.slice(split + 1));
  if (!start?.day || !end?.day) return null;
  return [{ ...start, month: start.month ?? end.month }, end];
}

function singleDateForms(
  { weekday, day, month }: DateEnd,
  fact: DateFact,
): FactForm[] {
  if (!day) return [];
  const forms: FactForm[] = [];
  const w = weekday ? nameOf(weekday) : null;
  if (!month) {
    /* "Saturday the 5th": no month, so only the weekday with "the" or an
       ordinal says it is a day. */
    if (!w) return [];
    return [
      form(`${w} the ${day}`, uncontradicted(fact)),
      form(`${w} ${day}`, ordinalDay(fact)),
    ];
  }
  const m = nameOf(month);
  forms.push(
    form(`${day} ${m}`, dateGuard(fact, DAY_FIRST_TAIL)),
    form(`${m} ${day}`, dateGuard(fact, DATE_TAIL)),
    form(`the ${day} of ${m}`, uncontradicted(fact)),
    form(`${day} of ${m}`, ordinalDay(fact)),
  );
  if (w) {
    for (const join of [" ", ", "]) {
      forms.push(
        form(`${w}${join}${day} ${m}`, uncontradicted(fact)),
        form(`${w}${join}the ${day} of ${m}`, uncontradicted(fact)),
        form(`${w}${join}${m} ${day}`, dateGuard(fact, DATE_TAIL)),
      );
    }
  }
  return forms;
}

function rangeDateForms(
  start: DateEnd,
  end: DateEnd,
  fact: DateFact,
): FactForm[] {
  const forms: FactForm[] = [];
  if (!start.month || !end.month) return forms;
  const [m1, m2] = [nameOf(start.month), nameOf(end.month)];
  const [d1, d2] = [start.day, end.day];
  const days =
    start.weekday && end.weekday
      ? [
          [nameOf(start.weekday), nameOf(end.weekday)],
          ["", ""],
        ]
      : [["", ""]];
  for (const to of ["-", "to"]) {
    for (const [w1, w2] of days) {
      const a = (rest: string) => (w1 ? `${w1} ${rest}` : rest);
      const b = (rest: string) => (w2 ? `${w2} ${rest}` : rest);
      const guard = w1 ? uncontradicted(fact) : dateGuard(fact, DAY_FIRST_TAIL);
      forms.push(form(`${a(`${d1} ${m1}`)} ${to} ${b(`${d2} ${m2}`)}`, guard));
      if (m1 === m2) {
        forms.push(form(`${a(`${d1}`)} ${to} ${b(`${d2} ${m2}`)}`, guard));
      }
    }
    forms.push(
      form(
        `${m1} ${d1} ${to} ${m1 === m2 ? "" : `${m2} `}${d2}`,
        dateGuard(fact, DATE_TAIL),
      ),
    );
  }
  return forms;
}

function dateFactOf(tokens: readonly CopyToken[]): DateFact {
  return {
    weekdays: new Set(tokens.map(weekdayOf).filter((d): d is string => !!d)),
    years: new Set(tokens.filter(isYear).map((t) => t.value ?? 0)),
  };
}

function dateForms(
  tokens: CopyToken[],
  needs: readonly string[],
  fact: DateFact,
): FactForm[] | null {
  const forms: FactForm[] = [];
  const numeric = tokens.some(
    (t, i) =>
      t.key === "/" && isNumber(tokens[i - 1]) && isNumber(tokens[i + 1]),
  );
  if (numeric) {
    /* "5/12" is read day first or month first by the brand's country, in
       needsFor; its own spelling stands too. */
    const own = tokens.filter((t) => isNumber(t) || t.key === "/");
    forms.push(
      form(own.map((t) => t.text).join(""), dateGuard(fact, DATE_TAIL)),
    );
    const day = needs.find((n) => n.startsWith("="))?.slice(1);
    const month = needs.find(
      (n) => n.startsWith("~") && MONTH_KEYS.includes(n.slice(1)),
    );
    if (day && month) {
      const index = MONTH_KEYS.indexOf(month.slice(1));
      const weekday = tokens.map(weekdayOf).find(Boolean) ?? null;
      forms.push(
        ...singleDateForms(
          { weekday, day, month: `w:~${MONTHS[index][0]}` },
          fact,
        ),
      );
    }
    return forms;
  }
  const ends = dateEndsOf(tokens);
  if (!ends) return null;
  if (ends.length === 2) return rangeDateForms(ends[0], ends[1], fact);
  const single = singleDateForms(ends[0], fact);
  return single.length > 0 ? single : null;
}

/* A count's own words that say how it is put, never what it counts: "only
   20 spots left" is stated by "20 spots". */
const COUNT_LEAD = ["only", "just"];
const COUNT_TAIL = ["only", "left", "remaining", "available"];
/* "Seats: 8" labels a count with its plural noun. "Seat: 8" is a seat's
   number and "Your table: 8" a table's, so the label is the fact's own
   plural noun (round-10 code critic, L2 and L3), and nothing follows the
   number but a word that cannot be what it counts. */
const LABEL_TAIL = [
  "only",
  "left",
  "max",
  "maximum",
  "total",
  "available",
  "remaining",
];
const labelled: Guard = ({ after }) =>
  endsClause(after) || word(after, ...LABEL_TAIL);

/* A count before "to" names what is to be done with it: "16 places to see
   around Ibadan" counts sights, not the retreat's 16 places (round-12
   holdout, H96). Read whole, "8 spots to grab" is refused with it, and
   the fact writer writes it in; any other word may follow a count ("50
   guests max", "Two senior React engineers wanted"). */
const notToDo: Guard = ({ after }) => !word(after, "to");

/* What may stand before a count: a clause's start or a word from this
   closed list, none of which changes how many. "Over 10 seats sold" is
   more than ten (round-12 code critic, G15), and so are "nearly", "about",
   "at least" and every word not named here, which the fact writer then
   writes in. "to" stays for "Send money to 20 African countries" and "Up
   to 16 places"; the spec records "close to 10 seats" as its residual. */
const COUNT_BEFORE = [
  /* "a dozen cupcakes": the article of a number word. */
  "a",
  "only",
  "just",
  "the",
  "all",
  "our",
  "your",
  "these",
  "those",
  "its",
  "their",
  "top",
  "with",
  "of",
  "for",
  "to",
  "and",
  "in",
  "across",
  "has",
  "have",
  "hiring",
  "win",
  "book",
  "reserve",
  "grab",
  "claim",
  "meet",
  "join",
  "featuring",
  "offering",
  "including",
];
const counted: Guard = (around) =>
  (startsClause(around) || word(around.before, ...COUNT_BEFORE)) &&
  notToDo(around);

function quantityForms(tokens: CopyToken[], own: string): FactForm[] {
  const hasWord = (ts: CopyToken[]) => ts.some((t) => t.kind === "word");
  if (!hasWord(tokens)) return [form(own, alone)];
  let core = tokens;
  while (core.length > 1 && word(core[0], ...COUNT_LEAD)) core = core.slice(1);
  while (core.length > 1 && word(core[core.length - 1], ...COUNT_TAIL)) {
    core = core.slice(0, -1);
  }
  const forms = [form(own, counted)];
  if (!hasWord(core) || !isNumber(core[0])) return forms;
  const [n, ...rest] = core.map((t) => t.text);
  const noun = rest.join(" ");
  /* "Just 20 more spots" is 20 spots (round-9 code critic, FN8). */
  forms.push(form(`${n} ${noun}`, counted), form(`${n} more ${noun}`, counted));
  if (rest.length === 1 && /s$/i.test(noun)) {
    for (const label of [`${noun}:`, `${noun} left:`]) {
      for (const lead of ["", "only ", "just "]) {
        forms.push(form(`${label} ${lead}${n}`, labelled));
      }
    }
  }
  return forms;
}

/* "a", "per", "each" and "/" say the same thing between an amount and its
   unit: "₦4,500 a slice" is "₦4,500 per slice" and "₦4,500/slice". */
const PER = ["a", "an", "per", "each", "/"];
/* What "a person", "a month" and the like are also written as, after the
   amount: "₦120,000 pp", "₦45,000 monthly" (round-12 critic holdout, F59
   and F63). Each says the one unit and nothing else. */
const SAME_UNIT: Record<string, string[]> = {
  person: ["pp", "per head", "a head"],
  head: ["pp", "per person", "a person"],
  day: ["daily"],
  week: ["weekly"],
  month: ["monthly"],
  year: ["yearly", "annually"],
};

/* A size the price is for ("a 1-litre bottle", "150ml tasters") is detail,
   not the unit: "₦15,500 bottle & 2 glasses" states "a 1-litre bottle and
   two glasses for ₦15,500" (round-6 live run). */
const MEASURE_UNIT =
  "(?:ml|cl|l|litres?|liters?|kg|g|grams?|cm|mm|inch(?:es)?|oz)";
const SIZE = new RegExp(
  `\\b\\d+(?:\\.\\d+)?\\s*-?\\s*${MEASURE_UNIT}\\b`,
  "gi",
);
const MEASURE_WORD = new RegExp(`^${MEASURE_UNIT}$`, "i");

function unitsOf(unit: string): string[] {
  const bare = unit.replace(SIZE, " ").replace(/\s+/g, " ").trim();
  return [...new Set([unit, bare].filter(Boolean))];
}

/* An amount after one of these is taken off a price, not the price: "Save
   ₦4,500 a slice" is a discount (round-9 code critic, FP14). The one word
   list the price forms keep: a discount verb not named here fails open, so
   the list is the spec's recorded residual. */
const DISCOUNT = [
  "save",
  "saves",
  "saving",
  "discount",
  "rebate",
  "cashback",
  "off",
  "less",
];
const notTakenOff: Guard = ({ before }) => !word(before, ...DISCOUNT);

/* What a price is "for", on either side of the amount and with no other
   words: "a 1-litre bottle and two glasses for ₦15,500", "₦15,500 for a
   1-litre bottle and two glasses". */
function forUnit(tokens: CopyToken[], m: number): string | null {
  const before = tokens.slice(0, m);
  const after = tokens.slice(m + 1);
  const side =
    after.length === 0 && word(before[before.length - 1], "for")
      ? before.slice(0, -1)
      : before.length === 0 && word(after[0], "for")
        ? after.slice(1)
        : null;
  if (!side || side.length === 0) return null;
  const unit = word(side[0], "a", "an", "the") ? side.slice(1) : side;
  return unit.map((t) => t.text).join(" ") || null;
}

function priceForms(tokens: CopyToken[], own: string): FactForm[] {
  return amountForms(tokens, own).map((f) => ({ ...f, guard: notTakenOff }));
}

function amountForms(tokens: CopyToken[], own: string): FactForm[] {
  const m = tokens.findIndex((t) => t.kind === "money");
  if (m < 0) return [form(own)];
  const text = (ts: CopyToken[]) => ts.map((t) => t.text).join(" ");
  const pre = text(tokens.slice(0, m));
  const amount = tokens[m].text;
  const post = tokens.slice(m + 1);
  const forms = [form(own)];
  const connector = post[0]?.key.replace(/^w:/, "");
  if (connector && PER.includes(connector) && post.length > 1) {
    for (const unit of unitsOf(text(post.slice(1)))) {
      for (const per of PER) {
        forms.push(form([pre, amount, per, unit].filter(Boolean).join(" ")));
      }
      if (!pre) {
        /* "A slice for ₦4,500" (round-12 critic holdout, F2). */
        for (const a of ["a", "an", "one", "per"]) {
          forms.push(form(`${a} ${unit} for ${amount}`));
        }
      }
      for (const same of SAME_UNIT[unit.toLowerCase()] ?? []) {
        forms.push(form([pre, amount, same].filter(Boolean).join(" ")));
      }
    }
  } else if (forUnit(tokens, m) !== null) {
    /* "three tasters for ₦6,000" is "₦6,000 for three tasters". */
    for (const u of unitsOf(forUnit(tokens, m) as string)) {
      forms.push(form(`${u} for ${amount}`), form(`${amount} for ${u}`));
      /* "₦15,500 bottle and two glasses" without "for", only when a word
         comes first: "₦4,500 2" is an amount beside some other number
         (round-12 code critic, P10). */
      if (/^\p{L}/u.test(u)) forms.push(form(`${amount} ${u}`));
      /* "Bottle and two glasses ₦15,500", the price list's own order
         (round 23, cafe): only when a word comes last, for the same
         reason. */
      if (/\p{L}$/u.test(u)) forms.push(form(`${u} ${amount}`));
    }
  } else if (post.length === 1 && word(post[0], "each", "apiece")) {
    for (const each of ["each", "apiece"]) {
      forms.push(form([pre, amount, each].filter(Boolean).join(" ")));
    }
  }
  return forms;
}

/* Hours without am or pm ("9-5") stand only where something makes them
   hours: at a clause's start or after an hours word or a day, and at a
   clause's end or before the days they are for. "Ages 9-5" and "Sizes
   9-5" are not hours (round-11 code critic, T19 and T20). */
const HOURS_LEAD = ["open", "opens", "opening", "hours", "from", "between"];
const HOURS_TAIL = ["daily", "only", "weekdays", "weekends", "everyday"];
const bareHours: Guard = (around) =>
  (startsClause(around) ||
    word(around.before, ...HOURS_LEAD) ||
    weekdayOf(around.before) !== null) &&
  (endsClause(around.after) ||
    word(around.after, ...HOURS_TAIL) ||
    weekdayOf(around.after) !== null);

function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  return `${String(h).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/* "9-5pm" puts both ends in the afternoon unless the start is later than
   the end ("11-2pm" runs from morning into afternoon) or it is 12. */
function sharedSuffixStart(hour: number, end: number): number {
  const pm = end >= 720;
  const endHour = Math.floor(end / 60) % 12;
  const startPm = pm && (hour % 12 <= endHour || hour === 12);
  return ((hour % 12) + (startPm ? 12 : 0)) * 60;
}

/* A range of clock times in each spelling, "9am-5pm" also as "9-5pm" when
   the start reads that way. */
function clockRanges(start: number, end: number): string[] {
  const hour = Math.floor(start / 60) % 12 || 12;
  const shared =
    start % 60 === 0 && sharedSuffixStart(hour, end) === start
      ? String(hour)
      : null;
  return ["-", "to", "till", "until"].flatMap((to) => [
    `${clock(start)} ${to} ${clock(end)}`,
    ...(shared ? [`${shared} ${to} ${clock(end)}`] : []),
  ]);
}

/* The words that say which days hours are for, used only to write the
   days before or after the hours ("9am-5pm weekdays" as "weekdays
   9am-5pm"). Which words a form must keep is not read from this list:
   every word of a time fact but a filler is a part (TIME_FILLERS). */
const DAY_WORDS = [
  "weekday",
  "weekdays",
  "weekend",
  "weekends",
  "daily",
  "everyday",
  "nightly",
  "every",
  ...WEEKDAY_NAMES.map((names) => `${names[0]}s`),
];
const isDayWord = (t: CopyToken | undefined) =>
  weekdayOf(t) !== null || word(t, ...DAY_WORDS);

/* The fact's days as one span in each spelling of its range ("Mon-Fri",
   "Monday to Friday"), or null when there are none; undefined when they
   are not one span, which no form but the fact's own words can write. */
function daySpansOf(tokens: readonly CopyToken[]): string[] | null | undefined {
  const at = tokens
    .map((t, i) => (isDayWord(t) ? i : -1))
    .filter((i) => i >= 0);
  if (at.length === 0) return null;
  const span = tokens.slice(at[0], at[at.length - 1] + 1);
  const joins = span.every(
    (t) => isDayWord(t) || TO.includes(t.key) || word(t, "and"),
  );
  if (!joins) return undefined;
  const spelled = (to: string) =>
    span.map((t) => (TO.includes(t.key) ? to : t.text)).join(" ");
  if (span.some((t) => TO.includes(t.key))) return ["-", "to"].map(spelled);
  if (span.length === 2 && afterEvery(span, 1)) {
    return [spelled(""), pluralOf(span[1])];
  }
  return [spelled("")];
}

/**
 * The words of a time fact a form may leave out: "at 7pm" and "from 7am"
 * say 7pm and 7am, and an article says nothing. Every other word is part
 * of the fact, and every form carries it: "by 10am" is a deadline, "until
 * 9pm" an end, "7pm till late" a night, "Tonight 8pm" one night, "Monthly,
 * 7pm" and "first Sunday of the month" not every week (round-12 code
 * critic, break 1). A closed list of the words that ARE parts dropped
 * every word it did not name.
 */
export const TIME_FILLERS = ["at", "the", "a"];

/* The word that joins two times or two weekdays into a range ("9am to
   5pm", "Monday to Friday") is spelled by each of the range's forms. */
const joinsRange = (tokens: readonly CopyToken[], i: number) =>
  TO.includes(tokens[i].key) &&
  ((isNumeric(tokens[i - 1]) && isNumeric(tokens[i + 1])) ||
    (weekdayOf(tokens[i - 1]) !== null && weekdayOf(tokens[i + 1]) !== null));

/* "every Saturday" is "Saturdays" and "every weekday" "weekdays": the one
   other spelling a time's day words take. */
const pluralOf = (t: CopyToken) => `${weekdayOf(t) ? nameOf(t.key) : t.text}s`;
const pluralKey = (t: CopyToken) => `w:${pluralOf(t).toLowerCase()}`;
const afterEvery = (tokens: readonly CopyToken[], i: number) =>
  word(tokens[i - 1], "every") && tokens[i]?.kind === "word";

/** The fact's hours as clock spellings, or null when they are not one
 *  time or one range. `from` and `to` are the indexes of its first and
 *  last number in `tokens`. */
function hoursOf(tokens: readonly CopyToken[]): {
  spellings: string[];
  bare: string[];
  from: number;
  to: number;
} | null {
  const numeric = tokens.filter(isNumeric);
  const clocks = numeric.filter((t) => t.kind === "clock");
  const span = (spellings: string[], bare: string[] = []) => ({
    spellings,
    bare,
    from: tokens.indexOf(numeric[0]),
    to: tokens.indexOf(numeric[numeric.length - 1]),
  });
  if (clocks.length > 0) {
    if (numeric.length === 1) {
      return span([clock(clocks[0].value ?? 0)]);
    }
    if (numeric.length !== 2) return null;
    const [start, end] = numeric;
    const between = tokens.slice(
      tokens.indexOf(start) + 1,
      tokens.indexOf(end),
    );
    if (between.length !== 1 || !TO.includes(between[0].key)) return null;
    if (end.kind !== "clock") return null;
    const startMinutes =
      start.kind === "clock"
        ? (start.value ?? 0)
        : isNumber(start)
          ? sharedSuffixStart(start.value ?? 0, end.value ?? 0)
          : null;
    if (startMinutes === null) return null;
    return span(
      clockRanges(startMinutes, end.value ?? 0),
      bareHoursOf(startMinutes, end.value ?? 0),
    );
  }
  if (numeric.length !== 2) return null;
  const [a, b] = numeric;
  const between = tokens.slice(tokens.indexOf(a) + 1, tokens.indexOf(b));
  if (between.length !== 1 || !TO.includes(between[0].key)) return null;
  /* "9-5" is stated by "9am-5pm": every reading of its hours that runs
     forward. */
  const spellings: string[] = [];
  for (const startHalf of [0, 720]) {
    for (const endHalf of [0, 720]) {
      const start = ((a.value ?? 0) % 12) * 60 + startHalf;
      const end = ((b.value ?? 0) % 12) * 60 + endHalf;
      if (start < end) spellings.push(...clockRanges(start, end));
    }
  }
  return span(spellings, [`${a.text}-${b.text}`, `${a.text} to ${b.text}`]);
}

/* "Open 9 to 5" states "9am to 5pm" when that is the only reading of 9 to
   5 that runs forward (round-12 critic holdout, F53): the bare hours read
   back to the fact's own hours and no other. On the hour only. */
function bareHoursOf(start: number, end: number): string[] {
  if (start % 60 !== 0 || end % 60 !== 0) return [];
  const [a, b] = [start / 60, end / 60].map((h) => h % 12 || 12);
  const readings: [number, number][] = [];
  for (const startHalf of [0, 720]) {
    for (const endHalf of [0, 720]) {
      const s = (a % 12) * 60 + startHalf;
      const e = (b % 12) * 60 + endHalf;
      if (s < e) readings.push([s, e]);
    }
  }
  const only =
    readings.length === 1 && readings[0][0] === start && readings[0][1] === end;
  return only ? [`${a}-${b}`, `${a} to ${b}`] : [];
}

/* What leads a time in the fact ("from 7am", "by 10am"), written before
   each of its spellings; a lead that is not a filler is a part, so only
   the forms that keep it stand. */
const TIME_LEAD = ["from", "at", "by", "until", "till", "before", "after"];

function timeForms(tokens: CopyToken[], own: string): FactForm[] | null {
  if (!tokens.some(isNumeric)) return null;
  const clocked = tokens.some((t) => t.kind === "clock");
  const forms = [form(own, clocked ? OPEN : bareHours)];
  const hours = hoursOf(tokens);
  if (!hours) return forms;
  forms.push(...inPlace(tokens, hours, clocked));
  const spans = daySpansOf(tokens);
  if (spans === undefined) return forms;
  const leads = tokens.filter((t) => word(t, ...TIME_LEAD)).map((t) => t.text);
  const times = [
    ...hours.spellings.map((s) => ({ s, guard: OPEN })),
    ...hours.bare.map((s) => ({ s, guard: bareHours })),
  ].flatMap(({ s, guard }) => [
    { s, guard },
    ...leads.map((lead) => ({ s: `${lead} ${s}`, guard })),
  ]);
  if (spans === null) {
    forms.push(...times.map(({ s, guard }) => form(s, guard)));
    return forms;
  }
  for (const days of spans) {
    for (const { s } of times) {
      for (const join of [" ", ", "]) {
        forms.push(form(`${days}${join}${s}`), form(`${s}${join}${days}`));
      }
    }
  }
  return forms;
}

/* The fact's own words with its hours in each spelling, so a time with
   words no generator writes ("first Sunday of the month, 4pm-6pm") is
   still stated by "4-6pm" in their place. */
function inPlace(
  tokens: readonly CopyToken[],
  hours: NonNullable<ReturnType<typeof hoursOf>>,
  clocked: boolean,
): FactForm[] {
  const text = (ts: readonly CopyToken[]) => ts.map((t) => t.text).join(" ");
  const before = text(tokens.slice(0, hours.from));
  const after = text(tokens.slice(hours.to + 1));
  const spelled = (s: string) => [before, s, after].filter(Boolean).join(" ");
  return [
    ...hours.spellings.map((s) => form(spelled(s), clocked ? OPEN : bareHours)),
    ...hours.bare.map((s) => form(spelled(s), bareHours)),
  ];
}

/* A place's number is held with the word it names: "Plot 5", "Phase 1",
   "9 Bourdillon". */
function placeForms(tokens: CopyToken[]): FactForm[] | null {
  const i = tokens.findIndex(isNumber);
  if (i < 0) return null;
  const prev = tokens[i - 1];
  const next = tokens[i + 1];
  if (prev?.kind === "word") return [form(`${prev.text} ${tokens[i].text}`)];
  if (next?.kind === "word") return [form(`${tokens[i].text} ${next.text}`)];
  return [form(tokens[i].text, alone)];
}

/* A part of a fact a form must carry, and what in a form carries it. */
interface FactPart {
  name: string;
  carriedBy: (t: CopyToken) => boolean;
}

const hourOfDay = (minutes: number) => Math.floor(minutes / 60) % 12;

/**
 * Every number, time, amount and calendar name of `tokens` (a fact) that
 * each of its forms must hold, and for a time every word but a filler
 * (TIME_FILLERS) and the word joining its range. A time's number may be
 * held as a clock ("9-5" as "09:00-17:00") and a clock as its hour
 * ("9-5pm"); "5/12"'s month as the month's name. Left out, by rule: a
 * date's weekdays and years once it names its month, for a single date or
 * a range ("12-14 December" states "Friday 12 December to Sunday 14
 * December"; contradicting one refuses it, see dateGuard), and the size in
 * a price's unit (round-6 live run).
 */
export function factPartsOf(
  kind: string,
  tokens: readonly CopyToken[],
): FactPart[] {
  const parts: FactPart[] = [];
  const isDate = kind === "date";
  const datedByMonth = isDate && tokens.some((t) => monthOf(t) !== null);
  const numericDate =
    isDate && tokens.some((t, i) => t.key === "/" && isNumber(tokens[i - 1]));
  tokens.forEach((t, i) => {
    if (isDate && isYear(t)) return;
    if (
      kind === "price" &&
      isNumber(t) &&
      ((tokens[i + 1]?.kind === "word" &&
        MEASURE_WORD.test(tokens[i + 1].text)) ||
        (tokens[i + 1]?.key === "-" &&
          MEASURE_WORD.test(tokens[i + 2]?.text ?? "")))
    ) {
      return;
    }
    if (t.kind === "money") {
      parts.push({ name: t.text, carriedBy: (c) => c.key === t.key });
    } else if (t.kind === "clock") {
      const m = t.value ?? 0;
      parts.push({
        name: t.text,
        carriedBy: (c) =>
          c.key === t.key ||
          (isNumber(c) && m % 60 === 0 && (c.value ?? 0) % 12 === hourOfDay(m)),
      });
    } else if (isNumber(t)) {
      const v = t.value ?? 0;
      parts.push({
        name: t.text,
        carriedBy: (c) =>
          c.key === t.key ||
          (kind === "time" &&
            c.kind === "clock" &&
            (c.value ?? 0) % 60 === 0 &&
            hourOfDay(c.value ?? 0) === v % 12) ||
          (numericDate && monthOf(c) === `w:~${MONTHS[v - 1]?.[0]}`),
      });
    } else if (weekdayOf(t) || monthOf(t)) {
      if (datedByMonth && weekdayOf(t)) return;
      const plural = kind === "time" && afterEvery(tokens, i) && pluralKey(t);
      parts.push({
        name: t.text,
        carriedBy: (c) => c.key === t.key || c.key === plural,
      });
    } else if (
      kind === "time" &&
      t.kind === "word" &&
      !word(t, ...TIME_FILLERS) &&
      !joinsRange(tokens, i)
    ) {
      const plural = word(t, "every")
        ? afterEvery(tokens, i + 1) && pluralKey(tokens[i + 1])
        : afterEvery(tokens, i) && pluralKey(t);
      parts.push({
        name: t.text,
        carriedBy: (c) => c.key === t.key || c.key === plural,
      });
    }
  });
  return parts;
}

/** The parts of the fact `form` leaves out. */
export function partsMissing(
  parts: readonly FactPart[],
  form: FactForm,
): string[] {
  return parts
    .filter((p) => !form.tokens.some((t) => p.carriedBy(t)))
    .map((p) => p.name);
}

/* Each form that carries the whole fact; when none does, the fact's own
   words, under the guard its own form would have. */
function wholeForms(
  kind: string,
  tokens: readonly CopyToken[],
  forms: readonly FactForm[],
  own: FactForm,
): FactForm[] {
  const parts = factPartsOf(kind, tokens);
  const seen = new Set<string>();
  const guards: (Guard | null)[] = [];
  const guardId = (g: Guard | null) =>
    guards.includes(g) ? guards.indexOf(g) : guards.push(g) - 1;
  const whole = forms.filter((f) => {
    const key = `${f.tokens.map((t) => t.key).join(" ")}|${guardId(f.guard)}`;
    if (seen.has(key) || partsMissing(parts, f).length > 0) return false;
    seen.add(key);
    return true;
  });
  return whole.length > 0 ? whole : [own];
}

const hasNumber = (tokens: readonly CopyToken[]) => tokens.some(isNumeric);

/**
 * A fact's forms, when it holds a number and its kind is read by form;
 * null when it is read by its words (an offer, a contact, a day name). A
 * fact whose shape is none of these keeps its own words as its one form.
 */
export function numberFactOf(fact: {
  kind: string;
  text: string;
  needs: readonly string[];
  pricedBeside?: readonly string[];
}): NumberFact | null {
  const key = `${fact.kind}\u0000${fact.text}\u0000${fact.needs.join("\u0001")}\u0000${(fact.pricedBeside ?? []).join("\u0001")}`;
  const cached = FACT_CACHE.get(key);
  if (cached !== undefined) return cached;
  if (FACT_CACHE.size >= FACT_CACHE_SIZE) FACT_CACHE.clear();
  const made = makeNumberFact(fact);
  FACT_CACHE.set(key, made);
  return made;
}

/* numberFactOf is pure and the verifier asks it for the same few facts
   once per field of every check; a job's facts fit many times over. */
const FACT_CACHE = new Map<string, NumberFact | null>();
const FACT_CACHE_SIZE = 2000;

function makeNumberFact(fact: {
  kind: string;
  text: string;
  needs: readonly string[];
  pricedBeside?: readonly string[];
}): NumberFact | null {
  const own = withoutEdgeMarks(tokensOf(meaningOf(fact.text)))
    .map((t) => t.text)
    .join(" ");
  const tokens = formTokensOf(own);
  if (!hasNumber(tokens)) return null;
  const whole = (forms: FactForm[] | null, ownGuard: Guard | null = OPEN) =>
    wholeForms(fact.kind, tokens, forms ?? [], form(own, ownGuard)).map(
      (f) => ({ ...f, kind: fact.kind }),
    );
  const plain = { alsoNeeds: [] as string[] };
  switch (fact.kind) {
    case "age": {
      const anchored = tokens.some((t) => word(t, ...AGE_WORDS));
      return {
        forms: whole(ageForms(tokens, own), anchored ? ageEnds : bareAge),
        ...plain,
      };
    }
    case "date": {
      const dated = dateFactOf(tokens);
      const forms = dateForms(tokens, fact.needs, dated);
      return {
        forms: whole(
          forms,
          forms === null && !tokens.some((t) => monthOf(t) || weekdayOf(t))
            ? alone
            : dateGuard(dated, DAY_FIRST_TAIL),
        ),
        /* The verb of what happens on the date, stated where the date is
           (brief-facts, dateWithEvent). */
        alsoNeeds: fact.needs.filter((n) => n.startsWith("!")),
        date: dated,
      };
    }
    case "quantity":
      return { forms: whole(quantityForms(tokens, own), counted), ...plain };
    case "price": {
      const priced = pricedItems(own, fact.pricedBeside ?? []);
      return {
        forms: whole(priceForms(tokens, own), notTakenOff).map((f) => ({
          ...f,
          priced,
        })),
        ...plain,
      };
    }
    case "time":
      return { forms: whole(timeForms(tokens, own)), ...plain };
    case "place": {
      const forms = placeForms(tokens);
      if (!forms) return null;
      return {
        forms: whole(forms),
        alsoNeeds: fact.needs.filter((n) => !n.startsWith("=")),
      };
    }
    case "day":
      return { forms: [form(own)], ...plain };
    default:
      return null;
  }
}

/* A run that starts or ends on a number may not continue a longer one:
   "1/20 stalls" and "1 200 guests" do not hold "20 stalls" or "200
   guests" (round-11 code critic, O4 to O7), nor "9am-5pm" "5pm". A year
   after a date's day ("December 5 2026", "December 5/2026") ends it. */
function cutFromNumber({ run, before, after, afterThat }: Around): boolean {
  const first = run[0];
  const last = run[run.length - 1];
  if (isNumeric(first) && (isNumeric(before) || joinsNumbers(before))) {
    return true;
  }
  return (
    isNumeric(last) &&
    ((isNumeric(after) && !isYear(after)) ||
      (joinsNumbers(after) && !isYear(afterThat)))
  );
}

/* A number a month or an ordinal makes a calendar day: "5 December",
   "Dec 6", "the 6th". */
function isDated(tokens: readonly CopyToken[], i: number): boolean {
  const t = tokens[i];
  return (
    isDayNumber(t) &&
    (Boolean(t.ordinal) ||
      monthOf(tokens[i - 1]) !== null ||
      monthOf(tokens[i + 1]) !== null)
  );
}

/* A number nothing after it gives a meaning: it ends the field or its
   clause ("or 6", "4, 5 December"). */
const isBare = (tokens: readonly CopyToken[], i: number) =>
  isNumber(tokens[i]) && endsClause(tokens[i + 1]);

/* A "+" or "%" makes a number an age or a share ("18+", "10%"), which no
   time is read as. */
const isAgeOrShare = (t: CopyToken | undefined) =>
  t?.key === "+" || t?.key === "%";

/* A phone's digit groups ("0803 555 0142", "08035550142") are one
   contact, not values: a price or count on a phone's line stands. */
const isPhoneDigits = (tokens: readonly CopyToken[], i: number) =>
  /^0\d/.test(tokens[i].text) ||
  isNumber(tokens[i - 1]) ||
  isNumber(tokens[i + 1]);

/* "6k" is six thousand: the tokenizer reads a scale only after a
   currency. */
const SCALES: Record<string, number> = {
  "w:k": 1_000,
  "w:m": 1_000_000,
  "w:million": 1_000_000,
};
const amountAt = (tokens: readonly CopyToken[], i: number) =>
  (tokens[i].value ?? 0) * (SCALES[tokens[i + 1]?.key ?? ""] ?? 1);

/* A count's rival is another count of the same thing, or a number with
   nothing attached that a reader would hang on the fact's noun. Round 17
   took any bare number in the field, and the eval at 5003e9e refused
   correct copy: "twelve new throws and cushions, each woven by one
   artisan", "Only 20 pieces · 12 Ozumba Mbadiwe Avenue", "SS1 to SS3
   students, two 90-minute sessions a week". A number that counts another
   noun, a day, a year, an age, a share, a phone group or a code is not a
   second answer to "how many".

   Nouns in one group name one thing a brief counts, said several ways:
   "10 seats or 12 spots" offers two counts of the places on offer, and so
   do "10 seats for 12 guests" and "10 seats or 12 students" (round-16
   attack, Q4): each answers how many can come. Kept small, so a count of
   something else stands beside the fact; a noun in no group matches only
   its own spelling, and "10 seats or 12 desks" fails open. The spec lists
   that residual. */
const COUNT_GROUPS = [
  [
    "seat",
    "chair",
    "bench",
    "stool",
    "spot",
    "place",
    "space",
    "slot",
    "ticket",
    "pass",
    "guest",
    "person",
    "attendee",
    "participant",
    "member",
    "student",
    "learner",
    "child",
    "kid",
    "adult",
  ],
  ["piece", "item", "unit"],
  ["session", "class", "lesson"],
];
const COUNT_GROUP = new Map(
  COUNT_GROUPS.flatMap((group) => group.map((noun) => [noun, group[0]])),
);
const IRREGULAR_PLURALS: Record<string, string> = {
  people: "person",
  children: "child",
  men: "man",
  women: "woman",
  classes: "class",
  passes: "pass",
};
function countNoun(t: CopyToken): string {
  return nounKey(t.key.slice(2));
}
function nounKey(w: string): string {
  const one = singularOf(w);
  return COUNT_GROUP.get(one) ?? one;
}
function singularOf(w: string): string {
  return (
    IRREGULAR_PLURALS[w] ??
    w
      .replace(/ies$/, "y")
      .replace(/(ss|sh|ch|x)es$/, "$1")
      .replace(/([^s])s$/, "$1")
  );
}

/* Words that say how a count is put, never what it counts: "12 more",
   "12 new throws", "12 left", "12 max", "2 booked". */
const COUNT_MODIFIERS = [
  ...new Set([
    ...COUNT_LEAD,
    ...COUNT_TAIL,
    ...LABEL_TAIL,
    "more",
    "new",
    "extra",
    "other",
    "additional",
    "further",
    "tops",
    "overall",
    "altogether",
    "min",
    "minimum",
    "booked",
    "taken",
    "sold",
    "reserved",
    "filled",
    "gone",
    "free",
    "open",
    "spare",
  ]),
];
/* A word after a number that attaches no noun to it, so the number is
   left to the noun a reader already has: "10 seats or 12", "Eight to 10
   seats", "10 seats (12 on Sunday)", "One in 10 seats", "1 of 10 seats",
   "5 x 10 seats". */
const NO_NOUN = [
  "or",
  "and",
  "nor",
  "to",
  "through",
  "till",
  "until",
  "of",
  "in",
  "out",
  "x",
  "×",
  "by",
  "on",
  "at",
  "for",
  "from",
  "with",
  "vs",
  "versus",
  "plus",
  "than",
  "if",
  "but",
  "the",
  "then",
  "is",
  "are",
  "was",
  "were",
];
/* A rate gives the number its own unit: "2 per room", "2 a week". */
const RATE = ["per", "a", "an", "each", "every"];
/* A word that numbers what it names: "Plot 5", "Shop 12", "Room 3". */
const NUMBERED = [
  "plot",
  "shop",
  "block",
  "no",
  "number",
  "room",
  "suite",
  "gate",
  "stand",
  "stall",
  "flat",
  "house",
  "floor",
  "level",
  "hall",
  "phase",
  "zone",
  "km",
  "table",
  "row",
  "door",
  "bus",
  "line",
  "unit",
  "lane",
  "road",
  "street",
  "avenue",
  "close",
  "estate",
  "junction",
];
/* A capital code before a number: "SS1", "JSS3", "P5". A code is one
   letter or has no vowel, so a word a headline in capitals puts before a
   rival ("10 SEATS · MAX 12", "CAP 12") is not one; these are the
   vowel-less words that are. */
const NOT_A_CODE = ["x", "vs", "by", "my", "pls"];
const isCode = (t: CopyToken | undefined) =>
  t?.kind === "word" &&
  /^[A-Z]{1,4}$/.test(t.text) &&
  (t.text.length === 1 ? !/^[AI]$/.test(t.text) : !/[AEIOU]/.test(t.text)) &&
  !word(t, ...NOT_A_CODE);
function isNumbered(
  tokens: readonly CopyToken[],
  i: number,
  codes = true,
): boolean {
  const before = tokens[i - 1];
  if (word(before, ...NUMBERED) || (codes && isCode(before))) return true;
  /* "No. 5" */
  return before?.key === "." && word(tokens[i - 2], "no");
}

/* A street address: "12 Ozumba Mbadiwe Avenue", "12 Herbert Macaulay
   Way", the number followed by names in title case up to the street's
   word. "10 seats or 12 at the market" is no address, and neither is one in
   capitals ("12 AT THE MARKET"), which fails closed. */
const STREET = [
  "avenue",
  "ave",
  "street",
  "st",
  "road",
  "rd",
  "way",
  "close",
  "crescent",
  "lane",
  "drive",
  "boulevard",
  "estate",
  "plaza",
  "mall",
  "market",
  "junction",
  "square",
];
function isAddress(tokens: readonly CopyToken[], i: number): boolean {
  for (const t of tokens.slice(i + 1, i + 5)) {
    if (t.kind !== "word" || !/^[A-Z][a-z]/.test(t.text)) return false;
    if (word(t, ...STREET)) return true;
  }
  return false;
}

/* What a number after the first counts names itself in the plural ("20
   pieces", "90 minutes", "2 rooms") or as a measure ("5kg"); any other
   word after it ("12 total", "12 booked") leaves it to the fact's noun. */
const PLURAL_NOT_NOUN = ["tops", "plus", "less", "yes", "this", "thus"];
const namesWhatItCounts = (t: CopyToken, one: boolean) =>
  one ||
  MEASURE_WORD.test(t.text) ||
  t.key.slice(2) in IRREGULAR_PLURALS ||
  (/s$/.test(t.key) && !word(t, ...PLURAL_NOT_NOUN));

/* An age: "18+", "Ages 7 to 12", "16 and over". `ageWords` are the
   words that make the number after them an age. */
function isAgeAt(
  tokens: readonly CopyToken[],
  i: number,
  ageWords: readonly string[] = AGE_WORDS,
): boolean {
  const before = tokens[i - 1];
  if (tokens[i + 1]?.key === "+" || word(before, ...ageWords)) return true;
  /* "Kids 4 and under free" bounds an age from above. */
  if (
    word(tokens[i + 1], "and") &&
    (AND_UP.some((up) => word(tokens[i + 2], up.split(" ")[1])) ||
      word(tokens[i + 2], "under", "below", "younger"))
  ) {
    return true;
  }
  return (
    (word(before, "to") || before?.key === "-") &&
    isNumber(tokens[i - 2]) &&
    word(tokens[i - 3], ...ageWords)
  );
}

/** The nouns a count's run counts, each in its group's one spelling. */
function countedNouns(run: readonly CopyToken[]): Set<string> {
  return new Set(
    run
      .filter(
        (t) =>
          t.kind === "word" &&
          !word(t, ...COUNT_MODIFIERS, ...NO_NOUN, ...RATE) &&
          t.key !== "w:one",
      )
      .map(countNoun),
  );
}

const countable = (t: CopyToken | undefined) =>
  isNumber(t) || t?.key === "w:one";

/* A number that is some other kind of value whatever follows it, so it
   is no count's or time's rival: a year, a day beside its month, a phone's
   digit group, a share ("20%"), an age ("18+", "Ages 7 to 12"), a number
   a place word or code numbers ("Plot 5", "SS1"), a street address. */
function isOtherValue(
  tokens: readonly CopyToken[],
  i: number,
  ageWords: readonly string[] = AGE_WORDS,
  codes = true,
): boolean {
  const t = tokens[i];
  return (
    isYear(t) ||
    monthOf(tokens[i - 1]) !== null ||
    monthOf(tokens[i + 1]) !== null ||
    isPhoneDigits(tokens, i) ||
    tokens[i + 1]?.key === "%" ||
    isAgeAt(tokens, i, ageWords) ||
    isNumbered(tokens, i, codes) ||
    isAddress(tokens, i)
  );
}

/* The words after the number at `i` that may name what it counts: past
   the words that only say how it is put ("12 more", "12 left"), up to
   three, stopping at a word that attaches nothing ("or", "to", "per").
   `next` is the token after them. */
function nounsAfter(
  tokens: readonly CopyToken[],
  i: number,
): { nouns: CopyToken[]; next: number } {
  let j = i + 1;
  while (word(tokens[j], ...COUNT_MODIFIERS)) j++;
  const nouns: CopyToken[] = [];
  while (
    nouns.length < 3 &&
    tokens[j]?.kind === "word" &&
    !word(tokens[j], ...NO_NOUN, ...RATE)
  ) {
    nouns.push(tokens[j]);
    j++;
  }
  return { nouns, next: j };
}

const namesItsNoun = (t: CopyToken, nouns: readonly CopyToken[]) =>
  nouns.some((n) => namesWhatItCounts(n, t.key === "w:one" || t.value === 1));

/* Words that offer two counts as one choice: "10 seats or 12 desks", "10
   seats vs 12 desks", "10 seats / 12 desks". */
const ALTERNATIVE = ["or", "vs", "versus", "/", "alternatively", "instead"];

const isAlternative = (t: CopyToken | undefined) =>
  t !== undefined && ALTERNATIVE.includes(t.key.replace(/^w:/, ""));
const putsNothing = (t: CopyToken) =>
  !isAlternative(t) && (t.kind === "mark" || word(t, ...COUNT_MODIFIERS));

/* Whether two counts, one ending at `from` and one starting at `to`, are
   offered as alternatives: the first word between them that says more
   than how a count is put is an ALTERNATIVE, and no clause break follows
   it ("10 seats or 12 desks", "12 desks / 10 seats", "12 cupcakes or
   choose 6 cookies", "Get 6 cookies or go for 12 cupcakes", "6 cookies,
   or a box of 12 cupcakes"; round-19 critics). */
function offeredAsAlternative(
  tokens: readonly CopyToken[],
  from: number,
  to: number,
): boolean {
  const between = tokens.slice(from, to);
  const first = between.findIndex((t) => !putsNothing(t));
  return (
    first >= 0 &&
    isAlternative(between[first]) &&
    between.slice(first + 1).every((t) => !t.breaks)
  );
}

/* Whether the number at `i` is another count of what the run counts:
   - the same noun or one of its group after it ("10 seats or 12 spots",
     "10 seats, 12 new seats");
   - no noun after it ("10 seats or twelve", "Eight to 10 seats", "1 of 10
     seats", "One in 10 seats");
   - a count of groups of a number ("5 rows of 10 seats", "5 tables x 10
     seats"), which multiplies the count;
   - a count of another noun offered as the run's alternative
     (offeredAsAlternative: "10 seats or 12 desks", "12 desks / 10 seats",
     "12 cupcakes or choose 6 cookies"). "or" makes the two numbers two answers to one question, and
     a noun outside every COUNT_GROUPS group cannot say whether desks are
     the seats, so the rule fails closed. A list ("10 seats · 2 hours",
     "10 seats, 1 instructor") and any other word between ("10 seats for
     12 desks", "each woven by one artisan") leave the other count its own
     noun.
   Never a day (beside a month, or an ordinal not counting "of" the run:
   "10th of 10 seats" is), nor an isOtherValue number, nor a number with
   its own noun or rate anywhere else ("one artisan", "90 minutes", "2 per
   room"). */
function countRival(
  tokens: readonly CopyToken[],
  i: number,
  {
    counts,
    perUnit,
    start,
    end,
  }: {
    counts: ReadonlySet<string>;
    perUnit: boolean;
    start: number;
    end: number;
  },
): boolean {
  const t = tokens[i];
  if (!countable(t)) return false;
  if (t.ordinal) return word(tokens[i + 1], "of");
  if (isOtherValue(tokens, i)) return false;
  /* "10 seats per row, 5 rows": a count per something is multiplied by
     any other count in its field. */
  if (perUnit) return true;
  if (word(tokens[i + 1], ...RATE)) return false;
  const { nouns, next } = nounsAfter(tokens, i);
  if (!namesItsNoun(t, nouns)) return true;
  if (nouns.some((n) => counts.has(countNoun(n)))) return true;
  if (
    (i >= end && offeredAsAlternative(tokens, end, i)) ||
    (i < start && offeredAsAlternative(tokens, next, start))
  ) {
    return true;
  }
  return (
    word(tokens[next], "x", "×") ||
    (word(tokens[next], "of") && countable(tokens[next + 1]))
  );
}

/* What a brief counts beside a time or a price, in nounKey's spelling
   with the COUNT_GROUPS. Closed: a time's or a price's plain number is
   exempt only when one of these, or a measure, follows it ("10 seats", "2
   hours", "12 stalls", "for 20 pieces"). Round 19's first draft took any
   word ending in "s", and the critics found hours and prices it passed:
   "dancing 9 onwards", "after-party 11 kicks off", "rerun 8 Jos", "Party
   pack for 30,000 serves 20". A noun not listed fails closed, and the
   fact writer gives the time its own field. */
const KNOWN_COUNTED = new Set(
  [
    ...COUNT_GROUPS.flat(),
    "minute",
    "min",
    "hour",
    "hr",
    "day",
    "week",
    "month",
    "year",
    "night",
    "evening",
    "morning",
    "weekend",
    "stall",
    "vendor",
    "exhibitor",
    "table",
    "room",
    "speaker",
    "artist",
    "act",
    "band",
    "performer",
    "dj",
    "course",
    "dish",
    "drink",
    "meal",
    "plate",
    "portion",
    "serving",
    "slice",
    "round",
    "game",
    "match",
    "track",
    "song",
    "hit",
    "stage",
    "venue",
    "city",
    "state",
    "country",
    "location",
    "branch",
    "outlet",
    "store",
    "cake",
    "cupcake",
    "cookie",
    "pastry",
    "box",
    "pack",
    "bottle",
    "tray",
    "flavour",
    "flavor",
    "colour",
    "color",
    "size",
    "design",
    "style",
    "winner",
    "prize",
    "coach",
    "trainer",
    "instructor",
    "teacher",
    "tutor",
    "chef",
    "stylist",
    "mentor",
    "team",
    "friend",
    "couple",
    "family",
    "step",
    "module",
    "workshop",
    "film",
    /* What the eval briefs count (eval/cases.ts), so a brief's own count
       beside its time or date is not taken for a rival: "From 8am. Three
       shots, one origin" (round-19 critic, T66). The gate test
       fact-forms.counted.test.ts fails when a brief counts a noun this
       list leaves out. */
    "shot",
    /* "single-origin" counts one origin, and copy says "one origin". */
    "origin",
    "throw",
    "cushion",
    "artisan",
    "engineer",
    "yard",
  ].map(nounKey),
);
const namesKnownCount = (t: CopyToken, nouns: readonly CopyToken[]) =>
  nouns.some(
    (n) =>
      namesWhatItCounts(n, t.key === "w:one" || t.value === 1) &&
      (KNOWN_COUNTED.has(countNoun(n)) || MEASURE_WORD.test(n.text)),
  );

/* The words that make the number after them an age and never a time.
   "Kids", "adults" and "children" also name who a session is for: "Kids
   4, adults 7pm" gives two hours (round-19 critic). */
const AGE_ONLY = ["ages", "aged", "age"];

/* A day word after a plain number makes it an hour, not a count: "Doors
   6 Fridays, 7pm Saturdays", "6 weekdays, 7pm weekends". */
const namesWhen = (nouns: readonly CopyToken[]) => nouns.some(isDayWord);

/* Words that join a number to the time after it as a range or a choice:
   "6 or 7pm", "6 to 7pm", "Kids 6 till 7pm". */
const HOUR_JOINS = [
  "or",
  "to",
  "till",
  "til",
  "until",
  "through",
  "thru",
  "and",
];

/* Whether the number at `i` reads as an hour beside the run's time:
   joined to the run's start by HOUR_JOINS or a "-" or "/" between numbers
   and nothing but marks. Whatever word numbers it then ("Kids 6 to 7pm",
   "Gate 6 or 7pm"), the reader takes it for the other end or the other
   choice; with only a comma ("Hall 2, 7pm") it stays a place. */
function joinedAsHour(
  tokens: readonly CopyToken[],
  i: number,
  start: number,
): boolean {
  if (i >= start || isAgeOrShare(tokens[i + 1])) return false;
  const between = tokens.slice(i + 1, start);
  return (
    between.some((t) => word(t, ...HOUR_JOINS) || joinsNumbers(t)) &&
    between.every((t) => t.kind === "mark" || word(t, ...HOUR_JOINS))
  );
}

/* Whether the number at `i` is another time beside the run's: a clock
   time, a plain number that could be an hour joined to the run as a range
   or a choice (joinedAsHour), or one with no noun or unit attached ("7pm
   or 8", "Doors 6, or 7pm", "7pm, starts 8", "7pm, 12 max"). Round 17
   took every plain number up to 24, and the eval at cb9f951 refused
   "Class runs 2pm to 5pm · 10 seats" (masterclass-ko): Oluwaseyi's
   ruling is a value of the time's own kind, and "10 seats" is a count.
   Never a count with its own noun ("10 seats", "2 hours"), a rate ("2 per
   table"), an isOtherValue number, a day, a code, an amount. */
function timeRival(
  tokens: readonly CopyToken[],
  i: number,
  start: number,
): boolean {
  const t = tokens[i];
  if (t.kind === "clock") return true;
  /* "1930hrs" is 7:30pm, which the tokenizer reads as a number of hours
     (round-19 critic). */
  if (
    isNumber(t) &&
    /^([01]\d|2[0-3])[0-5]\d$/.test(t.text) &&
    word(tokens[i + 1], "hours", "hrs", "hr", "h")
  ) {
    return true;
  }
  if (!isNumber(t) || t.ordinal || (t.value ?? 0) > 24) return false;
  if (
    isYear(t) ||
    monthOf(tokens[i - 1]) !== null ||
    monthOf(tokens[i + 1]) !== null ||
    isPhoneDigits(tokens, i)
  ) {
    return false;
  }
  if (joinedAsHour(tokens, i, start)) return true;
  /* A code before a number is no exemption here: "DJ 11" and "MC 10"
     are hours in event copy (round-19 critic). */
  if (isAgeOrShare(tokens[i + 1]) || isOtherValue(tokens, i, AGE_ONLY, false)) {
    return false;
  }
  if (word(tokens[i + 1], ...RATE)) return false;
  const { nouns } = nounsAfter(tokens, i);
  return namesWhen(nouns) || !namesKnownCount(t, nouns);
}

/* Whether the number at `i` is another price beside the run's amount:
   another amount, or a plain number of at least a tenth of it ("₦6,000 or
   5,000", "₦4,500 or 6k", "Adults ₦6,000 · Kids 3,000", "Advance ₦6,000 ·
   Gate 8,000", "₦6,000 regular, 4,500 students"), unless "for" makes it
   what the price buys ("₦6,000 for 10 people", "₦100 for 20 pieces").
   Only "for" exempts it: a tier names who pays or when, and a plural after
   the number ("3,000 kids", "8,000 weekends") is a tier as often as a
   count (round-19 critic, 13 fail-opens when any plural exempted it). A
   year, a day beside its month, a phone group and a share are never an
   amount. */
function priceRival(
  tokens: readonly CopyToken[],
  i: number,
  amount: number,
): boolean {
  const t = tokens[i];
  if (t.kind === "money") return true;
  if (!isNumber(t) || t.ordinal || amountAt(tokens, i) * 10 < amount) {
    return false;
  }
  /* "2,000" is an amount with its thousands mark; a year has none
     (round-19 critic: "₦6,000 · 2,000 deposit to book"). */
  const year = isYear(t) && !t.text.includes(",");
  if (
    year ||
    monthOf(tokens[i - 1]) !== null ||
    monthOf(tokens[i + 1]) !== null ||
    isPhoneDigits(tokens, i) ||
    tokens[i + 1]?.key === "%" ||
    isAddress(tokens, i)
  ) {
    return false;
  }
  const boughtFor =
    word(tokens[i - 1], "for") &&
    namesKnownCount(t, nounsAfter(tokens, i).nouns);
  return !boughtFor;
}

/* Whether the day number at `i`, in another clause than the date's run,
   is a day a reader takes as the date's alternative: a word follows it
   that names nothing it counts ("Friday 14 March, or 21 if it rains",
   "Pre-orders close 12 February, 13 for corporate orders", "Launching 3
   November — 10 in Abuja"). Round 16 took only a bare number there, and
   the round-19 critic put the word after it. A count of a listed noun
   ("5 December, 12 stalls"), a rate ("2 per table") and a number that is
   another kind of value (an age, a share, a code, an address) stand. */
function dayInWords(tokens: readonly CopyToken[], i: number): boolean {
  if (tokens[i + 1]?.kind !== "word") return false;
  if (isOtherValue(tokens, i) || word(tokens[i + 1], ...RATE)) return false;
  return !namesKnownCount(tokens[i], nounsAfter(tokens, i).nouns);
}

/* Words of a price that say how it is put, never what it buys: "₦4,500
   a slice", "₦18,000 each", "from ₦6,500". */
const NOT_AN_ITEM = [
  "for",
  "a",
  "an",
  "per",
  "the",
  "of",
  "and",
  "or",
  "with",
  "plus",
  "each",
  "apiece",
  "from",
  "only",
  "just",
  "at",
  "to",
  "by",
  "in",
  "on",
  "now",
  "was",
  "is",
  "naira",
  "ngn",
  ...DISCOUNT,
];

/* The words between an amount and the item it buys: "for", an article,
   a count ("two glasses") and a size ("1-litre bottle"). */
const BINDS_ITEM = ["for", "a", "an", "per", "the", "of"];

/** The item words of a price fact's text, singular: "tasters" of "three
 *  150ml tasters for ₦6,000", "bottle" and "glass" of "a 1-litre bottle
 *  and two glasses for ₦15,500". Plural folding only: the count groups
 *  would make "adults" and "kids" one item. */
function itemWordsOf(text: string): Set<string> {
  return new Set(
    formTokensOf(text)
      .filter(
        (t) =>
          t.kind === "word" &&
          !word(t, ...NOT_AN_ITEM) &&
          !MEASURE_WORD.test(t.text),
      )
      .map((t) => singularOf(t.key.slice(2))),
  );
}

/** The brief's priced items around one price: its own item words, and
 *  each other price's amount with the item words only that price has. */
function pricedItems(own: string, beside: readonly string[]): PricedItems {
  const ownWords = itemWordsOf(own);
  const others = beside.flatMap((text) => {
    const amount = formTokensOf(text).find((t) => t.kind === "money");
    const words = new Set(
      [...itemWordsOf(text)].filter((w) => !ownWords.has(w)),
    );
    return amount && words.size > 0 ? [{ amount: amount.key, words }] : [];
  });
  return { own: ownWords, others };
}

/** Whether the amount at `i` is bound to one of `words`: the item word
 *  stands directly before or after it, across only what binds an item to
 *  its price ("Bottle ₦15,500", "₦15,500 bottle", "bottle and two
 *  glasses for ₦15,500", "₦15,500 for a 1-litre bottle"). */
function boundToItem(
  tokens: readonly CopyToken[],
  i: number,
  words: ReadonlySet<string>,
): boolean {
  return [-1, 1].some((step) => {
    for (let j = i + step, k = 0; k < 6 && tokens[j]; j += step, k += 1) {
      const t = tokens[j];
      if (t.kind === "number" || (t.kind === "mark" && t.key === "-")) {
        continue;
      }
      if (t.kind !== "word") return false;
      if (word(t, ...BINDS_ITEM) || MEASURE_WORD.test(t.text)) continue;
      return words.has(singularOf(t.key.slice(2)));
    }
    return false;
  });
}

/* Whether the amount at `i` is another brief price bound to its own,
   different item in another clause, while the run's own amount is bound
   to the fact's item: a price list ("Flight ₦6,000 · Bottle ₦15,500"),
   not a choice. The orchestrator applying Oluwaseyi's "of its kind"
   ruling of 2026-10-28 to prices, as round 18 did to counts: two items'
   prices are not two values of one price (round 23, cafe: the footer
   "Flight ₦6,000 · Bottle ₦15,500" refused every rewrite, and the
   direction failed unnamed). Still rivals: an amount the brief does not
   give that item ("₦6,000 or ₦5,000"), a plain number ("₦6,000 ·
   5,000"), a tier the brief does not price ("Adults ₦6,000 · Kids
   ₦3,000" with no kids' price), an amount bound to no item or to the
   fact's own ("₦9,500 each, or ₦34,000"), and one in the run's own
   clause ("tasters ₦6,000 or bottle ₦15,500"). */
function pricedApart(
  tokens: readonly CopyToken[],
  i: number,
  run: { start: number; end: number; clause: readonly [number, number] },
  priced: PricedItems | undefined,
): boolean {
  const t = tokens[i];
  if (!priced || t.kind !== "money") return false;
  if (i >= run.clause[0] && i < run.clause[1]) return false;
  const other = priced.others.find((o) => o.amount === t.key);
  if (!other || !boundToItem(tokens, i, other.words)) return false;
  const runTokens = tokens.slice(run.start, run.end);
  const ownAmount = runTokens.findIndex((r) => r.kind === "money");
  return ownAmount >= 0 && boundToItem(runTokens, ownAmount, priced.own);
}

/* What counts as another value of the fact's kind, anywhere in its field
   (Oluwaseyi's ruling, 2026-10-28), read beyond the ruling's own words
   where a reader could still take the number for one, failing closed:
   - a time: any other clock time, or a plain number a reader takes for
     an hour (timeRival: "Six or 7pm", "7pm or 9", "Doors 6.30 or 7pm"),
     never a number that counts something ("2pm to 5pm · 10 seats");
   - a price: any other amount, or a plain number of at least a tenth of
     the run's that "for" does not make what it buys (priceRival: "4,500
     or ₦6,000", "₦4,500 or 6k"), so "three shots for ₦6,000" and
     "₦6,000 for 10 people" are not one;
   - a date: any other day of the month a month or an ordinal dates
     ("or 6 December", "or the 6th"), a bare one ("5 December, or 6"),
     and any in the run's own clause, which shares the run's month ("4
     and 5 December", "Apply between 1 and 30 November", "5 December or
     6 if it rains"), and one in another clause that a word follows but
     no listed noun names (dayInWords: "or 21 if it rains"); a count in
     another clause stands ("5 December, 12 stalls");
   - a count: another count of what the fact counts (countRival). */
function rivalAt(
  kind: string,
  tokens: readonly CopyToken[],
  i: number,
  run: {
    amount: number;
    clause: readonly [number, number];
    counts: ReadonlySet<string>;
    perUnit: boolean;
    start: number;
    end: number;
  },
): boolean {
  const t = tokens[i];
  switch (kind) {
    case "time":
      return timeRival(tokens, i, run.start);
    case "price":
      return priceRival(tokens, i, run.amount);
    case "date": {
      const inClause = i >= run.clause[0] && i < run.clause[1];
      return (
        isDated(tokens, i) ||
        (isDayNumber(t) &&
          (isBare(tokens, i) || inClause || dayInWords(tokens, i)))
      );
    }
    case "quantity":
      return countRival(tokens, i, run);
    default:
      return false;
  }
}

const RIVAL_KINDS = ["time", "price", "date", "quantity"];

/* What a value is compared by: "one" is 1, and an ordinal ("10th of 10
   seats") is a position, not the count. */
const valueKey = (t: CopyToken) =>
  `${t.key === "w:one" ? "n:1" : t.key}${t.ordinal ? "th" : ""}`;

/**
 * Whether the run's field holds another value of the fact's own kind, so
 * the run may be one end of a range or one choice of several: "6am, or
 * 7am", "₦6,000 (or ₦5,000)", "5 December, or 6", "16 places, or 20".
 * Field-wide, by Oluwaseyi's ruling of 2026-10-28: the field is the
 * headline, the subheadline, the button or one drawn footer line. Rounds
 * 14 to 16 looked one word or mark past the run, then one clause, and
 * each critic put the rival one step further ("6am, or 7am", round-16
 * code critic, finding 1). A value the run itself holds is the fact's
 * own: the other end of its range, or the same value said again. Correct
 * copy with two values of a kind in one field ("Doors 3pm, panel 4pm")
 * is refused, and the fact writer gives each its own field.
 *
 * Kinds without a rival rule (an age, a place) are refused by any other
 * number in their own clause: "18+ or 21+".
 */
function rivalled(
  around: Around,
  { kind, priced }: Pick<FactForm, "kind" | "priced">,
): boolean {
  const { run, field, at, preceding, following } = around;
  const tokens =
    at >= 0 ? field : [...[...preceding].reverse(), ...run, ...following];
  const start = at >= 0 ? at : preceding.length;
  const end = start + run.length;
  const own = new Set(run.filter(isNumeric).map(valueKey));
  const outside = (i: number) =>
    (i < start || i >= end) && !own.has(valueKey(tokens[i]));
  const clause = clauseAround(tokens, start, end);
  if (kind && RIVAL_KINDS.includes(kind)) {
    const amount = Math.max(
      0,
      ...run.filter((t) => t.kind === "money").map((t) => t.value ?? 0),
    );
    const counts = countedNouns(run);
    let past = end;
    while (word(tokens[past], ...COUNT_MODIFIERS)) past++;
    const perUnit = word(tokens[past], ...RATE);
    return tokens.some(
      (_, i) =>
        outside(i) &&
        rivalAt(kind, tokens, i, {
          amount,
          clause,
          counts,
          perUnit,
          start,
          end,
        }) &&
        !pricedApart(tokens, i, { start, end, clause }, priced),
    );
  }
  if (!run.some(isNumeric)) return false;
  return tokens
    .slice(...clause)
    .some((t, k) => isNumeric(t) && outside(clause[0] + k));
}

/** The text of a run of one of the date's forms in `tokens` that the
 *  design contradicts with another weekday or year ("5 December" in
 *  "Sunday, 10am, 5 December" for "Saturday 5 December"), or null. The
 *  verifier refuses such a run; this names it, so the fact writer is asked
 *  to fix the field rather than state the date again beside it (round-15
 *  code critic, finding 6). */
export function contradictedRun(
  fact: NumberFact,
  tokens: readonly CopyToken[],
  field: readonly CopyToken[] = tokens,
  design: readonly (readonly CopyToken[])[] = [field],
): string | null {
  const { date } = fact;
  if (!date || (date.weekdays.size === 0 && date.years.size === 0)) {
    return null;
  }
  for (const form of fact.forms) {
    for (const around of aroundEach(form, tokens, field, design)) {
      if (!cutFromNumber(around) && contradicted(date, around)) {
        return around.run.map((t) => t.text).join(" ");
      }
    }
  }
  return null;
}

/** Where in `field` each run of the date's forms starts that the design
 *  contradicts, in order: every run, so a sentence giving the date on the
 *  wrong day is found by where it stands, not by its words, which the
 *  sentence giving the right day may share (round-19 code critic,
 *  finding 5). */
export function contradictedRunStarts(
  fact: NumberFact,
  field: readonly CopyToken[],
  design: readonly (readonly CopyToken[])[] = [field],
): number[] {
  const { date } = fact;
  if (!date || (date.weekdays.size === 0 && date.years.size === 0)) {
    return [];
  }
  const starts = new Set<number>();
  for (const form of fact.forms) {
    for (const around of aroundEach(form, field, field, design)) {
      if (!cutFromNumber(around) && contradicted(date, around)) {
        starts.add(around.at);
      }
    }
  }
  return [...starts].sort((a, b) => a - b);
}

/** The text of a run of one of the fact's forms in `tokens` that would
 *  state it but for another value of its kind in the field (rivalled), or
 *  null. The fact writer is told which value stands in the way, since the
 *  fact's own words are already there (round-17 eval, textile store: both
 *  prices left one sentence and both were left off). */
export function rivalledRun(
  fact: NumberFact,
  tokens: readonly CopyToken[],
  field: readonly CopyToken[] = tokens,
  design: readonly (readonly CopyToken[])[] = [field],
): string | null {
  for (const form of fact.forms) {
    for (const around of aroundEach(form, tokens, field, design)) {
      if (
        !cutFromNumber(around) &&
        (!form.guard || form.guard(around)) &&
        rivalled(around, form)
      ) {
        return around.run.map((t) => t.text).join(" ");
      }
    }
  }
  return null;
}

/* Every run of `form` in `tokens`, with what stands around it. */
function aroundEach(
  form: FactForm,
  tokens: readonly CopyToken[],
  field: readonly CopyToken[],
  design: readonly (readonly CopyToken[])[],
): Around[] {
  const offset = field === tokens ? 0 : (runsOf(field, tokens)[0] ?? -1);
  return runsOf(tokens, form.tokens).map((i) => {
    const end = i + form.tokens.length;
    return {
      run: tokens.slice(i, end),
      before: tokens[i - 1],
      beforeThat: tokens[i - 2],
      after: tokens[end],
      afterThat: tokens[end + 1],
      following: tokens.slice(end),
      preceding: tokens.slice(0, i).reverse(),
      field,
      at: offset < 0 ? -1 : offset + i,
      design,
    };
  });
}

/** Whether `form` runs whole in `tokens` (read by formTokensOf), its guard
 *  satisfied. `field` is the whole field `tokens` stand in, when `tokens`
 *  are one item of it (a footer line's item); `design` is every field the
 *  design draws. */
export function formIn(
  form: FactForm,
  tokens: readonly CopyToken[],
  field: readonly CopyToken[] = tokens,
  design: readonly (readonly CopyToken[])[] = [field],
): boolean {
  return aroundEach(form, tokens, field, design).some(
    (around) =>
      !cutFromNumber(around) &&
      !rivalled(around, form) &&
      (!form.guard || form.guard(around)),
  );
}

/* "20-min" and "20-minute" are one duration, "2 hrs" and "2 hours" one
   length (round-5 live critic: a free call drawn twice in one footer). */
export function meaningOf(text: string): string {
  return (
    text
      .replace(/\b(\d+)\s*-?\s*(?:mins?|minutes?)\b/gi, "$1 minutes")
      .replace(/\b(\d+)\s*-?\s*(?:hrs?|hours?)\b/gi, "$1 hours")
      .replace(/\bpick[\s-]+up\b/gi, "pickup")
      .replace(/\s&\s/g, " and ")
      /* "'til" is "til": its apostrophe is not a break between two times
       (round-15 code critic, B5). */
      .replace(/(^|\s)['’](til|till)\b/gi, "$1$2")
      .replace(/\bincl\.?(?=\s|$)/gi, "included")
  );
}
