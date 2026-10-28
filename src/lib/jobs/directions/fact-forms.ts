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
 * out, because they name the day the rest already names: a single date's
 * weekday and its year. Neither may then be contradicted anywhere in the
 * field ("Sunday · 5 December", "5 December 2025").
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
  /** The whole field the run stands in: a footer item's whole line. */
  field: readonly CopyToken[];
}

/** Whether the tokens around a run let it stand as the fact. */
type Guard = (around: Around) => boolean;

export interface FactForm {
  /** The form as text, for tests and logs. */
  text: string;
  tokens: CopyToken[];
  guard: Guard | null;
}

export interface NumberFact {
  forms: FactForm[];
  /** What else the field must say: a place's street and area words. */
  alsoNeeds: string[];
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
   "to" stands only before a verb an age is for. */
const AGE_TAIL = [
  "only",
  "welcome",
  "please",
  "strictly",
  "at",
  "this",
  "every",
  "event",
  "events",
  "party",
  "night",
  "nights",
  "entry",
  "admission",
];
const AGE_VERBS = [
  "enter",
  "attend",
  "join",
  "register",
  "apply",
  "book",
  "buy",
  "drink",
  "play",
  "participate",
  "sign",
  "take",
];
const ageEnds: Guard = ({ after, afterThat }) =>
  endsClause(after) ||
  word(after, ...AGE_TAIL) ||
  (word(after, "to") && word(afterThat, ...AGE_VERBS)) ||
  /* "Ages 5-12 and 13-17": another age band, never a count's noun. */
  (word(after, "and") && isNumber(afterThat));
/* A bare age ("18+", "21 and over") also needs what comes before to make
   it an age: a clause's start or a word that introduces one ("Must be 18+
   to enter", "Strictly 18+"). "Over 18+ flavours" is a count (round-8 and
   round-10 code critic, N2 and B7). */
const AGE_LEAD = ["be", "strictly", "only", "for", "just"];
const bareAge: Guard = (around) =>
  (startsClause(around) || word(around.before, ...AGE_LEAD)) && ageEnds(around);

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
  if (!anchored) {
    forms.push(form(`${n}+ only`), form(`${n} and over only`));
    for (const up of [...ups, `${n} or over`, `${n} or older`]) {
      forms.push(form(up, bareAge));
    }
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

/* A date's weekday and year may be left out, never contradicted: any
   other weekday or year anywhere in the field refuses it ("Sunday · 5
   December", "5 December, Sunday" and "5 December 2025" for "Saturday 5
   December 2026"; round-11 code critic, DM9 to DM21). A date given with
   no weekday stands beside any: "Friday 1 November" states "1 November"
   (eval a at 5d49a60, fashion and masterclass). */
function contradicted({ weekdays, years }: DateFact, field: Around["field"]) {
  return field.some((t) => {
    const day = weekdayOf(t);
    if (day && weekdays.size > 0 && !weekdays.has(day)) return true;
    return isYear(t) && years.size > 0 && !years.has(t.value ?? 0);
  });
}

function dateGuard(fact: DateFact, tail: readonly string[]): Guard {
  return ({ run, before, after, afterThat, field }) => {
    if (contradicted(fact, field)) return false;
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
  ({ field }) =>
    !contradicted(fact, field);

const ordinalDay =
  (fact: DateFact): Guard =>
  (around) =>
    !contradicted(fact, around.field) &&
    Boolean(around.run.find(isNumber)?.ordinal);

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
const counted: Guard = ({ after }) => !word(after, "to");

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
    }
  } else if (forUnit(tokens, m) !== null) {
    /* "three tasters for ₦6,000" is "₦6,000 for three tasters". */
    for (const u of unitsOf(forUnit(tokens, m) as string)) {
      forms.push(
        form(`${u} for ${amount}`),
        form(`${amount} for ${u}`),
        form(`${amount} ${u}`),
      );
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

/* The words that say which days hours are for. A time with days keeps
   them in every form: "9am-5pm" is not "9am-5pm weekdays" (round-11 code
   critic, T15), nor "Sat 10am-2pm" "Mon-Fri 9am-5pm, Sat 10am-2pm" (T10). */
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
  const said = spelled("").toLowerCase();
  return SAME_DAYS.find((same) => same.includes(said)) ?? [said];
}

/* "every weekday" and "weekdays" name the same days. */
function sameDayKeys(key: string): string[] {
  const said = key.slice(2).replace(/s$/, "");
  const group = SAME_DAYS.find((same) =>
    same.some((s) => s.split(" ").pop()?.replace(/s$/, "") === said),
  );
  return group
    ? group
        .flatMap((s) => s.split(" ").filter((w) => w !== "every"))
        .map((w) => `w:${w}`)
    : [key];
}

/* Day words that name the same days. */
const SAME_DAYS = [
  ["every weekday", "weekdays"],
  ["every weekend", "weekends"],
  ["every day", "daily", "everyday"],
];

/* What leads a time in the fact ("from 7am", "at 4pm"), kept beside the
   days: "every weekday from 8am". */
const TIME_LEAD = ["from", "at", "by", "until", "till", "before", "after"];

/** The fact's hours as clock spellings, or null when they are not one
 *  time or one range. */
function hoursOf(tokens: readonly CopyToken[]): {
  spellings: string[];
  bare: string[];
} | null {
  const numeric = tokens.filter(isNumeric);
  const clocks = numeric.filter((t) => t.kind === "clock");
  if (clocks.length > 0) {
    if (numeric.length === 1) {
      return { spellings: [clock(clocks[0].value ?? 0)], bare: [] };
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
    return { spellings: clockRanges(startMinutes, end.value ?? 0), bare: [] };
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
  return { spellings, bare: [`${a.text}-${b.text}`, `${a.text} to ${b.text}`] };
}

function timeForms(tokens: CopyToken[], own: string): FactForm[] | null {
  if (!tokens.some(isNumeric)) return null;
  const clocked = tokens.some((t) => t.kind === "clock");
  const forms = [form(own, clocked ? OPEN : bareHours)];
  const hours = hoursOf(tokens);
  const spans = daySpansOf(tokens);
  if (!hours || spans === undefined) return forms;
  if (spans === null) {
    forms.push(...hours.spellings.map((s) => form(s)));
    forms.push(...hours.bare.map((s) => form(s, bareHours)));
    return forms;
  }
  const lead = tokens.find((t) => word(t, ...TIME_LEAD))?.text;
  const times = [...hours.spellings, ...hours.bare].flatMap((s) =>
    lead ? [s, `${lead} ${s}`] : [s],
  );
  for (const days of spans) {
    for (const time of times) {
      for (const join of [" ", ", "]) {
        forms.push(
          form(`${days}${join}${time}`),
          form(`${time}${join}${days}`),
        );
      }
    }
  }
  return forms;
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
 * each of its forms must hold. A time's number may be held as a clock
 * ("9-5" as "09:00-17:00") and a clock as its hour ("9-5pm"); "5/12"'s
 * month as the month's name. Left out, by rule: a single date's weekday
 * and year (contradicting either refuses it; see dateGuard), and the size
 * in a price's unit (round-6 live run).
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
      parts.push({ name: t.text, carriedBy: (c) => c.key === t.key });
    } else if (kind === "time" && isDayWord(t) && !word(t, "every")) {
      const same = sameDayKeys(t.key);
      parts.push({ name: t.text, carriedBy: (c) => same.includes(c.key) });
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
  const whole = forms.filter((f) => partsMissing(parts, f).length === 0);
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
}): NumberFact | null {
  const key = `${fact.kind}\u0000${fact.text}\u0000${fact.needs.join("\u0001")}`;
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
}): NumberFact | null {
  const own = withoutEdgeMarks(tokensOf(meaningOf(fact.text)))
    .map((t) => t.text)
    .join(" ");
  const tokens = formTokensOf(own);
  if (!hasNumber(tokens)) return null;
  const whole = (forms: FactForm[] | null, ownGuard: Guard | null = OPEN) =>
    wholeForms(fact.kind, tokens, forms ?? [], form(own, ownGuard));
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
        ...plain,
      };
    }
    case "quantity":
      return { forms: whole(quantityForms(tokens, own), counted), ...plain };
    case "price":
      return { forms: whole(priceForms(tokens, own), notTakenOff), ...plain };
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
   after a date's day ("December 5 2026") ends it. */
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

/** Whether `form` runs whole in `tokens` (read by formTokensOf), its guard
 *  satisfied. `field` is the whole field `tokens` stand in, when `tokens`
 *  are one item of it (a footer line's item). */
export function formIn(
  form: FactForm,
  tokens: readonly CopyToken[],
  field: readonly CopyToken[] = tokens,
): boolean {
  return runsOf(tokens, form.tokens).some((i) => {
    const end = i + form.tokens.length;
    const around: Around = {
      run: tokens.slice(i, end),
      before: tokens[i - 1],
      beforeThat: tokens[i - 2],
      after: tokens[end],
      afterThat: tokens[end + 1],
      field,
    };
    if (cutFromNumber(around)) return false;
    return !form.guard || form.guard(around);
  });
}

/* "20-min" and "20-minute" are one duration, "2 hrs" and "2 hours" one
   length (round-5 live critic: a free call drawn twice in one footer). */
export function meaningOf(text: string): string {
  return text
    .replace(/\b(\d+)\s*-?\s*(?:mins?|minutes?)\b/gi, "$1 minutes")
    .replace(/\b(\d+)\s*-?\s*(?:hrs?|hours?)\b/gi, "$1 hours")
    .replace(/\bpick[\s-]+up\b/gi, "pickup")
    .replace(/\s&\s/g, " and ")
    .replace(/\bincl\.?(?=\s|$)/gi, "included");
}
