import {
  type CopyToken,
  endsClause,
  runsOf,
  tokensOf,
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
  /** Calendar names the field must hold: the days of "9-5 weekdays". */
  days: string[];
}

const OPEN = null;

const WEEKDAYS = [
  ["monday", "mon"],
  ["tuesday", "tue", "tues"],
  ["wednesday", "wed"],
  ["thursday", "thu", "thur", "thurs"],
  ["friday", "fri"],
  ["saturday", "sat"],
  ["sunday", "sun"],
];
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
for (const names of [...WEEKDAYS, ...MONTHS]) {
  for (const [i, name] of names.entries()) {
    CALENDAR.set(name, { key: `w:~${names[0]}`, short: i > 0 });
  }
}

/** `tokens` with every weekday and month in one spelling, and the full
 *  stop after an abbreviated one ("Sat.") taken as part of it. */
function withCalendarNames(tokens: readonly CopyToken[]): CopyToken[] {
  const out: CopyToken[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    const name = t.kind === "word" ? CALENDAR.get(t.key.slice(2)) : undefined;
    if (!name) {
      out.push(t);
      continue;
    }
    out.push({ ...t, key: name.key });
    if (name.short && tokens[i + 1]?.key === ".") i += 1;
  }
  return out;
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
const weekdayOf = (t: CopyToken | undefined) =>
  t?.kind === "word" && WEEKDAYS.some((d) => t.key === `w:~${d[0]}`)
    ? t.key
    : null;
const monthOf = (t: CopyToken | undefined) =>
  t?.kind === "word" && MONTHS.some((m) => t.key === `w:~${m[0]}`)
    ? t.key
    : null;
const nameOf = (key: string) => key.slice(3);

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

/* A bare age ("18+", "21 and over") stands only where nothing makes it a
   count: at a clause's start or after a word that introduces an age ("Must
   be 18+ to enter", "Strictly 18+"), and before a clause's end or a word
   that cannot be what it counts. "18+ cocktails" and "Over 18+ flavours"
   are counts (round-8 and round-10 code critic, N2 and B7). */
const AGE_LEAD = ["be", "strictly", "only", "for", "just"];
const AGE_TAIL = [
  "only",
  "to",
  "welcome",
  "please",
  "strictly",
  "event",
  "events",
  "party",
  "night",
  "nights",
  "entry",
  "admission",
];
const ageEnds: Guard = ({ after }) =>
  endsClause(after) || word(after, ...AGE_TAIL);
const bareAge: Guard = (around) =>
  (startsClause(around) || word(around.before, ...AGE_LEAD)) && ageEnds(around);

/* The words that name an age: a form led by one is an age wherever it
   sits. */
const AGE_WORDS = ["ages", "aged", "age", "adults", "kids", "children"];
const AND_UP = ["and up", "and over", "and above", "and older"];

function ageForms(tokens: CopyToken[], own: string): FactForm[] | null {
  const anchored = tokens.some((t) => word(t, ...AGE_WORDS));
  const numbers = tokens
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => isNumber(t));
  if (numbers.length === 0) return null;
  /* "Age: 18+" labels an age; "all ages: 8+ flavours" counts flavours
     (round-9 code critic, FP2), so a labelled age ends where a bare one
     does. */
  const led = (span: string) =>
    AGE_WORDS.flatMap((w) => [
      form(`${w} ${span}`),
      form(`${w}: ${span}`, ageEnds),
    ]);
  const forms: FactForm[] = [];
  const [first, second] = numbers;
  const between = second
    ? tokens.slice(first.i + 1, second.i).map((t) => t.key)
    : [];
  if (second && (between.join() === "-" || between.join() === "w:to")) {
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
  if (!plus) return [form(own, anchored ? OPEN : bareAge)];
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

/* A day and its month ("5 December", "December 5") are a date unless a
   number sits before them, which makes the month the other number's ("12
   5 December"), or another weekday than the fact's does. They end where a
   date ends: at a clause's end or before a year, a time or a word that
   cannot be what the number counts. "December 5 stalls" and "Top 5
   December deals" are counts (round-10 code critic, DT9 and DT13). An
   ordinal ("5th") is always a day. */
const DATE_TAIL = [
  "at",
  "from",
  "till",
  "until",
  "onwards",
  "only",
  "in",
  "for",
];

function dateGuard(weekday: string | null): Guard {
  return ({ run, before, beforeThat, after, afterThat }) => {
    /* "12/5 December" and "12-5 December": a number joined on by a mark
       is the other number's. */
    const joined = before?.kind === "mark" && !before.breaks;
    if (isNumber(before) || before?.kind === "clock" || joined) return false;
    /* A fact with no weekday is stated beside any: "Friday 1 November"
       states "1 November" (eval a at 5d49a60, fashion and masterclass). */
    const otherDay = (t: CopyToken | undefined) => {
      const day = weekdayOf(t);
      return weekday !== null && day !== null && day !== weekday;
    };
    if (otherDay(before) || (before?.key === "," && otherDay(beforeThat))) {
      return false;
    }
    if (run.find(isNumber)?.ordinal) return true;
    return (
      endsClause(after) ||
      isYear(after) ||
      (after?.key === "/" && isYear(afterThat)) ||
      after?.kind === "clock" ||
      word(after, ...DATE_TAIL)
    );
  };
}

const ordinalDay: Guard = ({ run }) => Boolean(run.find(isNumber)?.ordinal);

interface DateEnd {
  weekday: string | null;
  day: string | null;
  month: string | null;
}

function dateEndOf(tokens: readonly CopyToken[]): DateEnd {
  const day = tokens.find(
    (t) =>
      isNumber(t) && !isYear(t) && (t.value ?? 0) >= 1 && (t.value ?? 0) <= 31,
  );
  return {
    weekday: tokens.map(weekdayOf).find(Boolean) ?? null,
    day: day ? String(day.value) : null,
    month: tokens.map(monthOf).find(Boolean) ?? null,
  };
}

const TO = ["-", "w:to", "w:till", "w:until", "w:through"];

/* "Friday 12 December to Sunday 14 December", "5-7 December": the two ends
   of a range, the first taking the second's month when it has none. */
function dateEndsOf(tokens: readonly CopyToken[]): DateEnd[] {
  const split = tokens.findIndex(
    (t, i) =>
      TO.includes(t.key) &&
      tokens.slice(0, i).some(isNumber) &&
      tokens.slice(i + 1).some(isNumber),
  );
  if (split < 0) return [dateEndOf(tokens)];
  const start = dateEndOf(tokens.slice(0, split));
  const end = dateEndOf(tokens.slice(split + 1));
  if (!start.day || !end.day) return [dateEndOf(tokens)];
  return [{ ...start, month: start.month ?? end.month }, end];
}

function singleDateForms({ weekday, day, month }: DateEnd): FactForm[] {
  if (!day) return [];
  const forms: FactForm[] = [];
  const w = weekday ? nameOf(weekday) : null;
  if (!month) {
    /* "Saturday the 5th": no month, so only the weekday with "the" or an
       ordinal says it is a day. */
    if (!w) return [];
    return [form(`${w} the ${day}`), form(`${w} ${day}`, ordinalDay)];
  }
  const m = nameOf(month);
  forms.push(
    form(`${day} ${m}`, dateGuard(weekday)),
    form(`${m} ${day}`, dateGuard(weekday)),
    form(`the ${day} of ${m}`),
    form(`${day} of ${m}`, ordinalDay),
  );
  if (w) {
    for (const join of [" ", ", "]) {
      forms.push(
        form(`${w}${join}${day} ${m}`),
        form(`${w}${join}the ${day} of ${m}`),
        form(`${w}${join}${m} ${day}`, dateGuard(weekday)),
      );
    }
  }
  return forms;
}

function rangeDateForms(start: DateEnd, end: DateEnd): FactForm[] {
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
  const guard = dateGuard(start.weekday);
  for (const to of ["-", "to"]) {
    for (const [w1, w2] of days) {
      const a = (rest: string) => (w1 ? `${w1} ${rest}` : rest);
      const b = (rest: string) => (w2 ? `${w2} ${rest}` : rest);
      const open = w1 ? OPEN : guard;
      forms.push(form(`${a(`${d1} ${m1}`)} ${to} ${b(`${d2} ${m2}`)}`, open));
      if (m1 === m2) {
        forms.push(form(`${a(`${d1}`)} ${to} ${b(`${d2} ${m2}`)}`, open));
      }
    }
    forms.push(
      form(
        `${m1} ${d1} ${to} ${m1 === m2 ? "" : `${m2} `}${d2}`,
        dateGuard(start.weekday),
      ),
    );
  }
  return forms;
}

function dateForms(
  tokens: CopyToken[],
  needs: readonly string[],
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
    forms.push(form(own.map((t) => t.text).join(""), dateGuard(null)));
    const day = needs.find((n) => n.startsWith("="))?.slice(1);
    const month = needs.find(
      (n) => n.startsWith("~") && MONTH_KEYS.includes(n.slice(1)),
    );
    if (day && month) {
      const index = MONTH_KEYS.indexOf(month.slice(1));
      const weekday = tokens.map(weekdayOf).find(Boolean) ?? null;
      forms.push(
        ...singleDateForms({ weekday, day, month: `w:~${MONTHS[index][0]}` }),
      );
    }
    return forms;
  }
  const ends = dateEndsOf(tokens);
  if (ends.length === 2) return rangeDateForms(ends[0], ends[1]);
  const single = singleDateForms(ends[0]);
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

function quantityForms(tokens: CopyToken[], own: string): FactForm[] {
  const hasWord = (ts: CopyToken[]) => ts.some((t) => t.kind === "word");
  if (!hasWord(tokens)) return [form(own, alone)];
  let core = tokens;
  while (core.length > 1 && word(core[0], ...COUNT_LEAD)) core = core.slice(1);
  while (core.length > 1 && word(core[core.length - 1], ...COUNT_TAIL)) {
    core = core.slice(0, -1);
  }
  const forms = [form(own)];
  if (!hasWord(core) || !isNumber(core[0])) return forms;
  const [n, ...rest] = core.map((t) => t.text);
  const counted = rest.join(" ");
  /* "Just 20 more spots" is 20 spots (round-9 code critic, FN8). */
  forms.push(form(`${n} ${counted}`), form(`${n} more ${counted}`));
  if (rest.length === 1 && /s$/i.test(counted)) {
    for (const label of [`${counted}:`, `${counted} left:`]) {
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
const SIZE =
  /\b\d+(?:\.\d+)?\s*-?\s*(?:ml|cl|l|litres?|liters?|kg|g|grams?|cm|mm|inch(?:es)?|oz)\b/gi;

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

/* Hours without am or pm ("9-5") stand only where nothing makes them a
   range of something else: not after a number, and at a clause's end or
   before the days they are for. */
const HOURS_TAIL = ["daily", "only", "weekdays", "weekends", "everyday"];
const bareHours: Guard = ({ before, after }) =>
  !isNumber(before) &&
  (endsClause(after) ||
    word(after, ...HOURS_TAIL) ||
    weekdayOf(after) !== null);

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
function clockRanges(start: number, end: number): FactForm[] {
  const hour = Math.floor(start / 60) % 12 || 12;
  const shared =
    start % 60 === 0 && sharedSuffixStart(hour, end) === start
      ? String(hour)
      : null;
  return ["-", "to", "till", "until"].flatMap((to) => [
    form(`${clock(start)} ${to} ${clock(end)}`),
    ...(shared ? [form(`${shared} ${to} ${clock(end)}`)] : []),
  ]);
}

function timeForms(tokens: CopyToken[], own: string): FactForm[] | null {
  const clocks = tokens.filter((t) => t.kind === "clock");
  if (clocks.length > 0) {
    const forms = [form(own)];
    const last = clocks[clocks.length - 1];
    const at = tokens.indexOf(last);
    const joined = TO.includes(tokens[at - 1]?.key ?? "");
    const start = tokens[at - 2];
    if (clocks.length >= 2 && joined && start?.kind === "clock") {
      forms.push(...clockRanges(start.value ?? 0, last.value ?? 0));
    } else if (joined && isNumber(start)) {
      forms.push(
        ...clockRanges(
          sharedSuffixStart(start?.value ?? 0, last.value ?? 0),
          last.value ?? 0,
        ),
      );
    } else {
      for (const c of clocks) forms.push(form(clock(c.value ?? 0)));
    }
    return forms;
  }
  const numbers = tokens.filter(isNumber);
  if (numbers.length === 0) return null;
  const [a, b] = numbers;
  if (!b) return [form(own, alone)];
  const forms = [
    form(`${a.text}-${b.text}`, bareHours),
    form(`${a.text} to ${b.text}`, bareHours),
  ];
  /* "9-5" is stated by "9am-5pm": every reading of its hours that runs
     forward. */
  for (const startHalf of [0, 720]) {
    for (const endHalf of [0, 720]) {
      const start = ((a.value ?? 0) % 12) * 60 + startHalf;
      const end = ((b.value ?? 0) % 12) * 60 + endHalf;
      if (start < end) forms.push(...clockRanges(start, end));
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

const hasNumber = (tokens: readonly CopyToken[]) =>
  tokens.some(
    (t) => t.kind === "number" || t.kind === "clock" || t.kind === "money",
  );

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
  const own = withoutEdgeMarks(tokensOf(meaningOf(fact.text)))
    .map((t) => t.text)
    .join(" ");
  const tokens = formTokensOf(own);
  if (!hasNumber(tokens)) return null;
  const plain = { alsoNeeds: [] as string[], days: [] as string[] };
  switch (fact.kind) {
    case "age": {
      const forms = ageForms(tokens, own);
      return forms ? { forms, ...plain } : null;
    }
    case "date":
      return {
        forms: dateForms(tokens, fact.needs) ?? [form(own, alone)],
        ...plain,
      };
    case "quantity":
      return { forms: quantityForms(tokens, own), ...plain };
    case "price":
      return { forms: priceForms(tokens, own), ...plain };
    case "time": {
      const forms = timeForms(tokens, own);
      if (!forms) return null;
      const clocked = tokens.some((t) => t.kind === "clock");
      const days = clocked
        ? []
        : fact.needs.filter((n) => n.startsWith("~")).map((n) => n.slice(1));
      return { forms, alsoNeeds: [], days };
    }
    case "place": {
      const forms = placeForms(tokens);
      if (!forms) return null;
      return {
        forms,
        alsoNeeds: fact.needs.filter((n) => !n.startsWith("=")),
        days: [],
      };
    }
    case "day":
      return { forms: [form(own)], ...plain };
    default:
      return null;
  }
}

/** Whether `form` runs whole in `tokens` (read by formTokensOf), its guard
 *  satisfied. */
export function formIn(form: FactForm, tokens: readonly CopyToken[]): boolean {
  return runsOf(tokens, form.tokens).some(
    (i) =>
      !form.guard ||
      form.guard({
        run: tokens.slice(i, i + form.tokens.length),
        before: tokens[i - 1],
        beforeThat: tokens[i - 2],
        after: tokens[i + form.tokens.length],
        afterThat: tokens[i + form.tokens.length + 1],
      }),
  );
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
