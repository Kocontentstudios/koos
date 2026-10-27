import {
  type CountryCode,
  findPhoneNumbersInText,
} from "libphonenumber-js/max";
import { calendarNames, looksCutOff, NUMBER_WORDS } from "./claims";
import { contentStems, stem } from "./text-overlap";

/**
 * The hard facts a brief states, and whether a design states them.
 *
 * inventedFacts stops copy saying what the brief does not; this is the other
 * direction. The round-2 workshop brief gave a day, a time, ages, a place and
 * a WhatsApp number, and both delivered designs dropped four of them.
 *
 * Finding the facts in a brief is reading, which a model does (brief-read.ts):
 * four rounds of hand patterns kept producing a wrong address ("9 Bourdillon
 * Road, Thursday"), a phone glued to the hour after it and a price without
 * its unit. Everything after the reading is code: every span must be the
 * brief's own words, a phone must be a valid number, a price keeps the unit
 * and quantity that follow it, and whether a design states a fact is decided
 * here, the same way every time.
 */

export const BRIEF_FACT_KINDS = [
  "day",
  "date",
  "time",
  "price",
  "quantity",
  "age",
  "place",
  "contact",
  "offer",
  "condition",
] as const;

export type BriefFactKind = (typeof BRIEF_FACT_KINDS)[number];

/** A fact a design must state: one the reader returned, or a real person
 *  the brief names (round-5 live critic: the named speaker was left off
 *  one direction while coverage reported every fact delivered). */
export type CoverKind = BriefFactKind | "person" | "product";

export interface BriefFact {
  kind: CoverKind;
  /** The brief's own words for it, which is what gets drawn when a
   *  direction left it out. */
  text: string;
  /** What has to appear for the fact to count as stated. */
  needs: string[];
}

/** A fact as the reader returned it, before it is held to the brief. */
export interface ReadFact {
  kind: string;
  text: string;
}

const WORD_NUMBER = new RegExp(
  `\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b`,
  "gi",
);

/** Every number in `text`, as values: "₦4,500", "4500", "4.5k" and
 *  "twelve" all count. */
function numbersIn(text: string): Set<string> {
  const values = new Set<string>();
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)(\s?k\b)?/gi)) {
    let value = Number.parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    if (m[2]) value *= 1000;
    values.add(String(value));
  }
  for (const m of text.matchAll(WORD_NUMBER)) {
    values.add(String(NUMBER_WORDS[m[1].toLowerCase()]));
  }
  return values;
}

/* "6.30pm" is half past six, not 30pm, and "07:00" with no am or pm is a
   24-hour clock. */
const CLOCK =
  /\b(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b|\b(noon|midday|midnight)\b/gi;

/* "2–5pm" puts both ends in the afternoon. */
const SHARED_SUFFIX =
  /\b(\d{1,2})(?:[:.](\d{2}))?\s?(?:[-–—]|to)\s?(\d{1,2})(?:[:.](\d{2}))?\s?(am|pm)\b/gi;

/** Minutes past midnight for every clock time in `text`. */
function timesIn(text: string): Set<string> {
  const times = new Set<string>();
  for (const m of text.matchAll(SHARED_SUFFIX)) {
    const pm = m[5].toLowerCase() === "pm";
    const start = Number(m[1]);
    const end = Number(m[3]);
    /* "11–2pm" runs from morning into afternoon; "12–6pm" from noon
       (round-5 live critic: "12–6pm" read as midnight, so "12pm to 6pm"
       beside it was not taken for the same hours). */
    const startPm = pm && (start <= end || start === 12);
    times.add(
      String(((start % 12) + (startPm ? 12 : 0)) * 60 + Number(m[2] ?? 0)),
    );
  }
  for (const m of text.matchAll(CLOCK)) {
    if (m[6]) {
      times.add(m[6].toLowerCase() === "midnight" ? "0" : "720");
    } else if (m[4]) {
      times.add(String(Number(m[4]) * 60 + Number(m[5])));
    } else {
      const hour = (Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0);
      times.add(String(hour * 60 + Number(m[2] ?? 0)));
    }
  }
  return times;
}

/* Words a design may abbreviate or leave out of an address without losing
   it: "9 Bourdillon Rd" states "9 Bourdillon Road". */
const ADDRESS_GENERIC = contentStems(
  "road rd street st way avenue ave close crescent cres drive lane boulevard blvd estate plaza square expressway highway court terrace parade shop plot suite floor",
);
/* Words that say how a fact is put, never what it is. */
const FILLER = contentStems(
  "only just call book order get visit find join available open from per each every for and the our your with via text message dm us ngn naira usd dollar dollars gbp eur",
);

/* Day-first everywhere but the United States, where 3/11 is March 11. */
const MONTH_FIRST: ReadonlySet<string> = new Set(["US", "PH", "FM", "MH"]);
const MONTH_ORDER = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/* Where a brand's phone numbers are dialled from, read off its profile. A
   number written with its +country code is found whatever this says. */
const REGION_HINTS: [RegExp, CountryCode][] = [
  [/\b(nigeria|lagos|abuja|ibadan|port harcourt|kano|enugu)\b|\.ng\b/i, "NG"],
  [/\b(ghana|accra|kumasi)\b|\.gh\b/i, "GH"],
  [/\b(kenya|nairobi|mombasa)\b|\.ke\b/i, "KE"],
  [/\b(south africa|johannesburg|cape town|durban)\b|\.za\b/i, "ZA"],
  [/\b(united kingdom|england|london|manchester|uk)\b|\.co\.uk\b/i, "GB"],
  [/\b(united states|usa|new york|los angeles|chicago|houston)\b/i, "US"],
  [/\b(canada|toronto|vancouver)\b/i, "CA"],
];

/** The country a brand's numbers are read in: the first its profile names,
 *  else Nigeria, where KO's brands are. */
export function brandRegion(
  profile: (string | null | undefined)[],
): CountryCode {
  const text = profile.filter(Boolean).join(" \n ");
  return REGION_HINTS.find(([pattern]) => pattern.test(text))?.[1] ?? "NG";
}

/* A count is matched by value ("4" or "four"), never as a word. */
function isNumberWord(stem: string): boolean {
  return /^\d+$/.test(stem) || stem in NUMBER_WORDS;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function digitsOf(text: string): string {
  return text.replace(/\D/g, "");
}

interface PhoneSpan {
  start: number;
  end: number;
  /** The number without its country code or trunk 0. */
  national: string;
  /** Every way of writing the number a design may use: the brief's own
   *  digits, with the country code, and with the trunk 0. */
  variants: string[];
}

/* Where a brand's numbers are dialled from first, then any country the
   brief itself names: an Accra number in a Lagos brand's brief is still a
   number (round-5 code critic). */
export function phoneRegions(
  briefText: string,
  profileRegion: CountryCode,
): CountryCode[] {
  const regions: CountryCode[] = [profileRegion];
  for (const [pattern, region] of REGION_HINTS) {
    if (pattern.test(briefText) && !regions.includes(region)) {
      regions.push(region);
    }
  }
  return regions;
}

function asRegions(region: CountryCode | readonly CountryCode[]) {
  return typeof region === "string" ? [region] : [...region];
}

/* "0803 555 0142 9-5" swallowed the hours into the number, and the number
   failed validation; the reader rarely hands over a span like that, but
   when it does the trailing words are dropped one at a time until the
   number reads. */
function phonesInRegion(text: string, region: CountryCode): PhoneSpan[] {
  const spans: PhoneSpan[] = [];
  let from = 0;
  /* One number at a time, read again from where the last one ended:
     "0803 555 0142, 0805 555 0199" is read as the first number with the
     second's prefix for an extension, and the second was lost (round-5 code
     critic). */
  while (from < text.length) {
    const next = firstPhone(text.slice(from), region);
    if (!next) break;
    spans.push({ ...next, start: next.start + from, end: next.end + from });
    from += next.end;
  }
  return spans;
}

function firstPhone(text: string, region: CountryCode): PhoneSpan | null {
  let candidate = text;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const found = findPhoneNumbersInText(candidate, region).find((f) =>
      f.number.isValid(),
    );
    if (found) {
      const national = String(found.number.nationalNumber);
      const forms = [
        `${found.number.countryCallingCode}${national}`,
        `0${national}`,
        national,
      ];
      const surface = text.slice(found.startsAt, found.endsAt);
      const own = digitsOf(surface);
      /* libphonenumber reads "08035550142, 9" as the number with an
         extension; the number is drawn and matched without it. */
      const written = forms.find((form) => own.startsWith(form)) ?? own;
      return {
        start: found.startsAt,
        end: found.startsAt + digitEnd(surface, written.length),
        national,
        variants: [...new Set([written, ...forms.slice(0, 2)])],
      };
    }
    const shorter = candidate.replace(/[\s,;:]*\S+\s*$/, "");
    if (shorter === candidate || !shorter) break;
    candidate = shorter;
  }
  return null;
}

/** Every valid phone number in `text`, read in each region in turn; a span
 *  an earlier region read is kept. */
function phonesIn(
  text: string,
  region: CountryCode | readonly CountryCode[],
): PhoneSpan[] {
  const spans: PhoneSpan[] = [];
  for (const r of asRegions(region)) {
    for (const phone of phonesInRegion(text, r)) {
      const overlaps = spans.some(
        (s) => phone.start < s.end && phone.end > s.start,
      );
      if (!overlaps) spans.push(phone);
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** The offset in `surface` just past its `count`th digit. */
function digitEnd(surface: string, count: number): number {
  let seen = 0;
  for (let i = 0; i < surface.length; i += 1) {
    if (/\d/.test(surface[i])) seen += 1;
    if (seen === count) return i + 1;
  }
  return surface.length;
}

/* A run of seven or more digits, allowing the spaces and dashes people
   group a phone number with. */
const PHONE_LIKE = /(?:\d[\s().-]{0,2}){7,}/;

/* "9 Bourdillon Road, Thursday to Sunday": an address ends before the day
   or time that follows it. A weekday only ends it when it reads as a day,
   not as part of a name: "Shop 4, Sunday Market, Ikeja" is one address
   (round-5 code critic). */
const AFTER_ADDRESS =
  /(?:,\s*|\s+(?:on|from|every)\s+)(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?s?\b(?=\s*(?:$|[,;.&\u2013\u2014-]|to\b|and\b|through\b|thru\b|from\b|only\b|\d))|\d{1,2}(?:[:.]\d{2})?\s?(?:am|pm)\b|daily\b|weekdays?\b|weekends?\b).*$/i;

/* The nouns a price is "a", "per" or "for N" of. A price grows only by one
   of these: "₦3,000 an amazing deal" and "₦5,000 for Saturday's show" grew
   into "an amazing" and "for Saturday" when any word would do (round-5 code
   critic). */
const UNIT_NOUN =
  "(?:slices?|pieces?|pcs|box(?:es)?|packs?|packets?|sets?|pairs?|bags?|bottles?|cups?|glass(?:es)?|plates?|bowls?|trays?|dozens?|loaf|loaves|jars?|tins?|cans?|cartons?|crates?|cases?|portions?|servings?|meals?|kg|kilos?|grams?|g|litres?|liters?|ml|cl|persons?|people|heads?|seats?|tickets?|guests?|couples?|adults?|child(?:ren)?|kids?|students?|learners?|entr(?:y|ies)|items?|units?|nights?|hours?|hrs?|days?|weeks?|months?|years?|sessions?|class(?:es)?|lessons?|visits?|trips?|rides?|rooms?|tables?|copies|copy|courses?|spots?|places?|shots?|scoops?|yards?|metres?|meters?|pages?|users?|members?|bundles?|rolls?|sticks?|wraps?|sachets?|pots?|cones?|tubs?|outfits?|looks?|hairdos?|styles?|minutes?|mins?|rounds?|bouquets?|stems?|cakes?|cupcakes?|pastries)";
const COUNT = `(?:\\d+|${Object.keys(NUMBER_WORDS).join("|")}|one)`;
const PRICE_UNIT = new RegExp(
  [
    `^\\s*(?:a|an|per|each)\\s+(?:${COUNT}\\s+)?${UNIT_NOUN}\\b`,
    `^\\s*\\/\\s*${UNIT_NOUN}\\b`,
    `^\\s*for\\s+(?:a|an|one|the)?\\s*(?:set|pack|box|bundle|pair|bag|tray|dozen|bottle|case|crate|basket|hamper)\\s+of\\s+${COUNT}\\b(?:\\s+${UNIT_NOUN}\\b)?`,
    `^\\s*for\\s+${COUNT}\\b(?:\\s+${UNIT_NOUN}\\b)?`,
    "^\\s*(?:each|apiece)\\b",
  ].join("|"),
  "iu",
);

function priceWithUnit(brief: string, end: number): number {
  const after = PRICE_UNIT.exec(brief.slice(end));
  return after ? end + after[0].length : end;
}

/* A size or volume: "1-litre", "150ml", "10kg", "2 yards" is not one (a
   yard is what is sold by the yard). */
const MEASURE =
  /\b\d+(?:\.\d+)?\s*-?\s*(?:ml|cl|l|litres?|liters?|kg|g|grams?|cm|mm|inch(?:es)?|oz)\b/gi;

const EVERY_DAY = /\b(daily|every ?day|7 days a week|seven days a week)\b/i;

/** What has to appear in a design for it to state `text` as a `kind`. */
export function needsFor(
  kind: CoverKind,
  text: string,
  regions: CountryCode | readonly CountryCode[] = "NG",
): string[] {
  const region = asRegions(regions)[0] ?? "NG";
  const numbers = () => [...numbersIn(text)].map((n) => `=${n}`);
  const stems = (ignore: ReadonlySet<string> = FILLER) =>
    [...contentStems(text)]
      .filter((s) => !ignore.has(s) && !isNumberWord(s))
      .map((s) => `^${s}`);
  const days = () => [...new Set(calendarNames(text))].map((d) => `~${d}`);
  switch (kind) {
    case "contact": {
      const phones = phonesIn(text, regions);
      if (phones.length > 0) {
        return phones.map((p) => `#${p.variants.join(",")}`);
      }
      const literal =
        /[\w.+-]+@[\w-]+\.[\w.]+|@[\w.]{2,}|(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:\/[\w/.-]*)?/i.exec(
          text,
        );
      if (literal) {
        return [literal[0].toLowerCase().replace(/^https?:\/\//, "")];
      }
      return stems();
    }
    case "day": {
      const named = days();
      if (named.length > 0) return named;
      /* "every day" is all stopwords, and was dropped as saying nothing
         (round-5 live run, cafe). */
      if (EVERY_DAY.test(text)) return ["%daily"];
      return stems();
    }
    case "date": {
      const numeric = /\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/.exec(text);
      if (numeric) {
        const [a, b] = [Number(numeric[1]), Number(numeric[2])];
        const [day, month] = MONTH_FIRST.has(region) ? [b, a] : [a, b];
        if (month >= 1 && month <= 12) {
          return [`=${day}`, `~${MONTH_ORDER[month - 1]}`, ...days()];
        }
      }
      return [...numbers(), ...days()];
    }
    case "time": {
      /* Hours with no am or pm keep their numbers, and the days they are
         for: "9-5 weekdays" read as only "weekdays" lost the hours
         (round-6 code critic). */
      const times = [...timesIn(text)].map((t) => `@${t}`);
      return times.length > 0 ? times : [...numbers(), ...days()];
    }
    case "price": {
      /* A size the price is for ("a 1-litre bottle", "150ml tasters") is
         detail, not the fact: "₦15,500 bottle & 2 glasses" states "a
         1-litre bottle and two glasses for ₦15,500" (round-6 live run). */
      const sizes = [...text.matchAll(MEASURE)];
      if (sizes.length === 0) return [...numbers(), ...stems()];
      const bare = text.replace(MEASURE, " ");
      const sizeStems = contentStems(sizes.map((m) => m[0]).join(" "));
      return [
        ...[...numbersIn(bare)].map((n) => `=${n}`),
        ...[...contentStems(bare)]
          .filter(
            (s) => !FILLER.has(s) && !isNumberWord(s) && !sizeStems.has(s),
          )
          .map((s) => `^${s}`),
      ];
    }
    case "quantity":
      return [...numbers(), ...stems()];
    case "age":
      return numbers();
    case "place": {
      const first = numbers().slice(0, 1);
      return [...first, ...stems(new Set([...FILLER, ...ADDRESS_GENERIC]))];
    }
    case "offer":
    case "condition":
      return stems();
    case "person":
    case "product":
      return [...contentStems(text)]
        .filter((s) => !isNumberWord(s))
        .map((s) => `^${s}`);
  }
}

export interface BriefFactRead {
  facts: BriefFact[];
  /** What the reader returned that is not the brief's own words, or not a
   *  usable fact, and why: logged and recorded, never drawn. */
  dropped: { text: string; why: string }[];
  /** Facts the reader saw but could not be held to the brief's words: a
   *  span with a number, a day or a contact in it. Never drawn, but each is
   *  checked against the delivered copy and recorded as left off when the
   *  copy does not state it (round-5 code critic: a phone read as "0803
   *  555 0142" for "0803-555-0142" was lost with no record). */
  unread: BriefFact[];
  /** Phone numbers in the brief the reader did not return, made facts by
   *  libphonenumber. */
  phonesAdded: string[];
}

interface Token {
  norm: string;
  start: number;
  end: number;
}

/* A word or a number, never part of one: "2pm" is not inside "12pm", "ice"
   not inside "price", "Ada" not inside "Adaeze" (round-5 code critic). */
const TOKEN = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;

function tokensOf(text: string): Token[] {
  return [...text.matchAll(TOKEN)].map((m) => ({
    norm: m[0]
      .toLowerCase()
      .replace(/’/g, "'")
      .replace(/^(\d+)(?:st|nd|rd|th)$/, "$1"),
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

function onBoundary(brief: string, start: number, end: number): boolean {
  const before = start > 0 ? brief[start - 1] : "";
  const after = end < brief.length ? brief[end] : "";
  return (
    !(before && WORD_CHAR.test(before) && WORD_CHAR.test(brief[start])) &&
    !(after && WORD_CHAR.test(after) && WORD_CHAR.test(brief[end - 1]))
  );
}

/* A currency sign, a plus or a handle's @ belongs to the word it touches:
   matched by words alone, "₦4,500" would be drawn as "4,500". */
function withAttachedSigns(
  brief: string,
  [start, end]: [number, number],
): [number, number] {
  let s = start;
  while (s > 0 && /[₦$£€+@#]/.test(brief[s - 1])) s -= 1;
  let e = end;
  while (e < brief.length && /[%+]/.test(brief[e])) e += 1;
  return [s, e];
}

function sameSpan(a: [number, number], b: readonly [number, number]) {
  return a[0] === b[0] && a[1] === b[1];
}

/** The token-run spans of `brief` that say `words` in order. */
function tokenRuns(
  brief: string,
  briefTokens: Token[],
  words: string[],
): [number, number][] {
  const runs: [number, number][] = [];
  if (words.length === 0) return runs;
  for (let i = 0; i + words.length <= briefTokens.length; i += 1) {
    if (words.every((w, j) => briefTokens[i + j].norm === w)) {
      runs.push(
        withAttachedSigns(brief, [
          briefTokens[i].start,
          briefTokens[i + words.length - 1].end,
        ]),
      );
    }
  }
  return runs;
}

/**
 * Where `text` sits in the brief, as the brief's own words, never inside a
 * longer word: exactly, else word for word with any punctuation or spacing
 * between ("0803 555 0142" for "0803-555-0142", "15th" for "15"). A span
 * already given to another fact is skipped, so two facts reading the same
 * words twice take two places (round-5 code critic: two "₦4,500" both took
 * the first).
 */
function locate(
  brief: string,
  briefTokens: Token[],
  text: string,
  taken: readonly (readonly [number, number])[],
): [number, number] | null {
  const free = (span: [number, number]) =>
    !taken.some((t) => sameSpan(span, t));
  const lowerBrief = brief.toLowerCase();
  const lowerText = text.toLowerCase();
  for (
    let at = lowerBrief.indexOf(lowerText);
    at >= 0;
    at = lowerBrief.indexOf(lowerText, at + 1)
  ) {
    const span: [number, number] = [at, at + text.length];
    if (onBoundary(brief, ...span) && free(span)) return span;
  }
  const words = tokensOf(text).map((t) => t.norm);
  return tokenRuns(brief, briefTokens, words).find(free) ?? null;
}

/**
 * The longest run of `text`'s words the brief says in order that keeps
 * every number `text` has, for a span the reader put in its own words
 * around the brief's ("Saturday 15th November" for "15 November", "₦4,500
 * a slice" for "₦4,500 per slice"). Null without a number to anchor it: a
 * run of plain words could be anything.
 */
function nearestRun(
  brief: string,
  briefTokens: Token[],
  text: string,
  taken: readonly (readonly [number, number])[],
): [number, number] | null {
  const words = tokensOf(text).map((t) => t.norm);
  const numbers = words.filter((w) => /\d/.test(w));
  if (numbers.length === 0) return null;
  /* A lone number is not a reading of anything: "5" of "Friday, December
     5th" would be drawn as the date. */
  const shortest = Math.max(numbers.length, Math.min(2, words.length));
  for (let length = words.length - 1; length >= shortest; length -= 1) {
    for (let from = 0; from + length <= words.length; from += 1) {
      const run = words.slice(from, from + length);
      if (!numbers.every((n) => run.includes(n))) continue;
      const span = tokenRuns(brief, briefTokens, run).find(
        (candidate) => !taken.some((t) => sameSpan(candidate, t)),
      );
      if (span) return span;
    }
  }
  return null;
}

/* "9-5" or "10–6": opening hours written without am or pm. */
const HOUR_RANGE = /\b\d{1,2}(?:[:.]\d{2})?\s?[-–]\s?\d{1,2}(?:[:.]\d{2})?\b/;

/* What a span after a contact's number says by itself, when it says
   anything a customer acts on: the hours or a count the reader glued to
   the number. */
function kindOfRemainder(text: string): BriefFactKind | null {
  if (timesIn(text).size > 0 || HOUR_RANGE.test(text)) return "time";
  if (calendarNames(text).length > 0) return "day";
  if (/[₦$£€]\s?\d|\d\s?(?:naira|ngn)\b/i.test(text)) return "price";
  if (/\d/.test(text)) return "quantity";
  return null;
}

/* A span the reader returned that holds something a customer acts on: a
   number, a day or a way to get in touch. Losing one is recorded. */
function holdsHardDetail(text: string): boolean {
  return (
    /\d/.test(text) ||
    calendarNames(text).length > 0 ||
    /@|https?:|www\.|\.(?:com|ng|co|org|net|io|shop|store)\b/i.test(text)
  );
}

/* Words a span may end on only when it is cut off: "₦4,500 a box for the"
   was drawn as a price (round-5 code critic), "Zero transfer fees for
   your" as a footer (round-5 live critic). */
const DANGLING_WORD =
  /\s+(?:a|an|the|and|or|but|of|for|to|with|from|at|in|on|by|per|your|our|their|its|my|this|that|these|those|every|than|into|which|who)$/i;

function withoutDanglingWords(text: string): string {
  let out = text.trim().replace(/[\s,;:–—-]+$/, "");
  while (DANGLING_WORD.test(out)) {
    out = out.replace(DANGLING_WORD, "").replace(/[\s,;:–—-]+$/, "");
  }
  return out;
}

const LEAD_WORD = /\p{L}[\p{L}'’-]*[\s:]+$/u;
const NOT_A_LEAD =
  /^(?:to|on|at|via|or|and|is|are|the|a|an|number|no|num|us|me|from|by|of|for|with|in):?$/i;

const CHANNEL_BEFORE =
  /\b(?:whatsapp|call(?:\s+or\s+whatsapp)?|text|phone|tel|sms|mobile|ring|dm|book(?:ings?)?|order|reach us)\b(?:\s+(?:us|me))?(?:\s+(?:on|at|via))?[\s:.-]*$/i;

/* A clock time read bare ("10am") keeps the word that says how it stands:
   "by 10am", "from 7am" (round-6 live run: a footer that read only
   "10am"). */
const TIME_LEAD = /\b(?:by|from|at|until|till|before|after|between)\s+$/iu;

/** Whether `text` says nothing but a time, date, number or contact: no
 *  word a reader could take as context. */
export function isBare(text: string): boolean {
  const words = text
    .replace(/\b\d{1,2}(?:[:.]\d{2})?\s?(?:am|pm)\b/gi, " ")
    .replace(
      /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi,
      " ",
    )
    .match(/\p{L}{2,}/gu);
  return !words && /\d/.test(text);
}

const COUNT_ONLY = new RegExp(
  `^(?:${Object.keys(NUMBER_WORDS).join("|")}|one|\\d[\\d,.]*)$`,
  "i",
);

/** A footer item no one can act on alone: a bare time, number or count
 *  ("Two", "10am"), or one cut off mid-phrase (round-6 critics: "Two" on
 *  both recruitment directions). */
export function isFragment(item: string): boolean {
  const text = item.trim().replace(/[.!]+$/, "");
  /* "₦2,000 each" ends on a word a cut-off phrase ends on, but is a whole
     price. */
  const wholePrice = moneyIn(text).size > 0 && /\b(?:each|apiece)$/i.test(text);
  return (
    isBare(text) || COUNT_ONLY.test(text) || (!wholePrice && looksCutOff(text))
  );
}

/** A footer line that prints a time beside a phone number, where the time
 *  reads as the phone's hours. */
export function timeOnPhoneLine(line: string): boolean {
  return (
    PHONE_LIKE.test(line) &&
    (timesIn(line.replace(new RegExp(PHONE_LIKE.source, "g"), " ")).size > 0 ||
      HOUR_RANGE.test(line.replace(new RegExp(PHONE_LIKE.source, "g"), " ")))
  );
}

function isKind(kind: string): kind is BriefFactKind {
  return (BRIEF_FACT_KINDS as readonly string[]).includes(kind);
}

interface Located extends BriefFact {
  start: number;
  end: number;
}

/**
 * The reader's facts, held to the brief: every span must be the brief's own
 * words, matched on whole words; a phone number must be a valid number in
 * the brand's country or one the brief names, and a contact span holding
 * two numbers is two facts, with anything the reader glued after the last
 * number read as its own fact; an address ends before the day or time after
 * it; a price keeps the unit or quantity that follows it, and only that; no
 * fact ends on a dangling word; the product itself is never a fact (it is
 * the design's subject, and drawn as a footer "fact" it read as a dump,
 * round-4 live critic); a fact inside another is dropped for the longer
 * one; every valid phone number in the brief is a fact whether the reader
 * returned it or not. In the brief's order.
 */
export function settleBriefFacts(
  read: readonly ReadFact[],
  briefText: string,
  {
    region = "NG",
    product = "",
  }: { region?: CountryCode | readonly CountryCode[]; product?: string },
): BriefFactRead {
  const brief = briefText ?? "";
  const briefTokens = tokensOf(brief);
  const regions = asRegions(region);
  const dropped: BriefFactRead["dropped"] = [];
  const unread: BriefFact[] = [];
  const located: Located[] = [];
  const productStems = contentStems(product);
  const briefPhones = phonesIn(brief, regions);
  const queue: { kind: string; text: string }[] = read.map((r) => ({
    kind: r.kind,
    text: r.text ?? "",
  }));
  /* The brief's words each reading was matched to, before any growing or
     cutting, so a second reading of the same words takes their next
     occurrence. */
  const claimed: [number, number][] = [];
  const taken = () => [
    ...claimed,
    ...located.map((f) => [f.start, f.end] as const),
  ];

  const lose = (kind: BriefFactKind, text: string, why: string) => {
    const needs = needsFor(kind, text, regions);
    if (holdsHardDetail(text) && needs.length > 0) {
      unread.push({ kind, text, needs });
    }
    dropped.push({ text, why });
  };

  const keep = (kind: BriefFactKind, from: number, end: number) => {
    let start = from;
    if (kind === "time" && isBare(brief.slice(start, end))) {
      const lead = TIME_LEAD.exec(brief.slice(Math.max(0, start - 30), start));
      if (lead) start -= lead[0].length;
    }
    const raw = brief.slice(start, end);
    const text = withoutDanglingWords(raw);
    if (!text) {
      dropped.push({ text: raw.trim(), why: "nothing left once trimmed" });
      return;
    }
    const trimmedEnd = start + raw.indexOf(text) + text.length;
    const stems = [...contentStems(text)].filter((s) => !/^\d+$/.test(s));
    if (
      productStems.size > 0 &&
      stems.length > 0 &&
      stems.every((s) => productStems.has(s)) &&
      numbersIn(text).size === 0
    ) {
      dropped.push({ text, why: "the product itself, not a fact about it" });
      return;
    }
    const needs = needsFor(kind, text, regions);
    if (needs.length === 0) {
      dropped.push({ text, why: "nothing in it a design could state" });
      return;
    }
    located.push({
      kind,
      text: kind === "day" || kind === "date" ? capitalise(text) : text,
      needs,
      start: start + raw.indexOf(text),
      end: trimmedEnd,
    });
  };

  while (queue.length > 0) {
    const raw = queue.shift() as { kind: string; text: string };
    const said = raw.text.trim().replace(/[\s.,;:!]+$/, "");
    if (!said) continue;
    if (!isKind(raw.kind)) {
      dropped.push({ text: said, why: `unknown kind "${raw.kind}"` });
      continue;
    }
    const kind = raw.kind;
    let at = locate(brief, briefTokens, said, taken());
    if (!at && kind === "contact" && PHONE_LIKE.test(said)) {
      /* Phones compared digit for digit: "08035550142" is "0803 555
         0142". A number the brief does not hold is dropped; the brief's
         own numbers are facts below whatever the reader said. */
      const digits = digitsOf(said);
      const phone = briefPhones.find(
        (p) => digits.endsWith(p.national) || p.variants.includes(digits),
      );
      if (!phone) {
        dropped.push({
          text: said,
          why: "a phone number the brief does not hold",
        });
        continue;
      }
      at = [phone.start, phone.end];
    }
    if (!at && kind !== "contact") {
      at = nearestRun(brief, briefTokens, said, taken());
    }
    if (!at) {
      lose(kind, said, "not the brief's own words");
      continue;
    }
    claimed.push(at);
    let [start, end] = at;
    if (kind === "contact") {
      const span = brief.slice(start, end);
      const phones = phonesIn(span, regions);
      if (phones.length === 0 && PHONE_LIKE.test(span)) {
        dropped.push({ text: said, why: "not a valid phone number" });
        continue;
      }
      if (phones.length > 0) {
        /* The channel the brief puts before the number ("WhatsApp"), when
           the reader's span began at the digits. */
        const lead = CHANNEL_BEFORE.exec(
          brief.slice(Math.max(0, start - 30), start),
        );
        const from =
          lead && phones[0].start === 0 ? start - lead[0].length : start;
        keep("contact", from, start + phones[0].end);
        for (const [k, phone] of phones.entries()) {
          if (k === 0) continue;
          const gap = span
            .slice(phones[k - 1].end, phone.start)
            .replace(/^[\s,;/&]*(?:or|and)?[\s,;/&]*/i, "");
          const channel = CHANNEL_BEFORE.test(gap) ? gap.length : 0;
          keep("contact", start + phone.start - channel, start + phone.end);
        }
        const rest = span.slice(phones[phones.length - 1].end);
        const restText = rest.replace(/^[\s,;:/&()–—-]+/, "").trim();
        if (restText) {
          const restKind = kindOfRemainder(restText);
          /* "9" cut from "9-5" by the reader's span is a fragment, not a
             count; the reader's own reading of the hours stands. */
          const fragment =
            (restKind === "quantity" && !/\p{L}/u.test(restText)) ||
            /^(?:ext|x)\b/i.test(restText);
          if (restKind && !fragment) {
            queue.push({ kind: restKind, text: restText });
          } else {
            dropped.push({
              text: restText,
              why: "after the contact, and not a fact by itself",
            });
          }
        }
        continue;
      }
    }
    if (kind === "place") {
      const span = brief.slice(start, end);
      const cut = AFTER_ADDRESS.exec(span);
      if (cut && cut.index > 0) end = start + cut.index;
    }
    if (kind === "price") end = priceWithUnit(brief, end);
    keep(kind, start, end);
  }

  /* The reader's answer is a reading; a valid phone number in the brief is
     a fact whether it returned it or not (round-5 code critic: a design
     shipped without the brief's only number and was recorded complete). */
  const phonesAdded: string[] = [];
  for (const phone of briefPhones) {
    const held = located.some(
      (f) =>
        f.kind === "contact" && phone.start >= f.start && phone.end <= f.end,
    );
    if (held) continue;
    /* The brief's own word before the number, whatever it is: "Opay
       8035550142" is an account, and drawn as a bare number it was
       labelled a phone (round-6 code critic). */
    const preceding = brief.slice(Math.max(0, phone.start - 30), phone.start);
    const word = LEAD_WORD.exec(preceding);
    const lead =
      CHANNEL_BEFORE.exec(preceding) ??
      (word && !NOT_A_LEAD.test(word[0].trim()) ? word : null);
    const before = located.length;
    keep("contact", phone.start - (lead?.[0].length ?? 0), phone.end);
    if (located.length > before) phonesAdded.push(located[before].text);
  }

  located.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Located[] = [];
  for (const fact of located) {
    const inside = kept.find((k) => fact.start >= k.start && fact.end <= k.end);
    if (inside) {
      dropped.push({ text: fact.text, why: `part of "${inside.text}"` });
      continue;
    }
    kept.push(fact);
  }
  /* A span the reader misread is not lost when the brief's own words for it
     are a fact anyway (a phone a digit out, beside the backstop's). */
  const keptText = drawnTextOf(kept.map((f) => f.text));
  return {
    facts: kept.map(({ start: _s, end: _e, ...fact }) => fact),
    dropped,
    unread: unread.filter((fact) => !factStated(fact, keptText)),
    phonesAdded,
  };
}

function drawnTextOf(lines: string[]): string {
  return lines.join(" \n ");
}

/* A phone number is stated only whole, on one line, between digit-group
   boundaries: concatenating every digit of the copy counted "WhatsApp 0803
   555 014" over "Ages 2-5" as the number (round-4 code critic). */
function phoneStated(variants: string[], copy: string): boolean {
  return variants.some((digits) => {
    const pattern = digits.split("").join("[ \\t.()\\-–]{0,2}");
    return new RegExp(`(?<!\\d)\\+?${pattern}(?!\\d)`).test(copy);
  });
}

/* "20-min" and "20-minute" are one duration, "2 hrs" and "2 hours" one
   length (round-5 live critic: a free call drawn twice in one footer). */
function meaningOf(text: string): string {
  return text
    .replace(/\b(\d+)\s*-?\s*(?:mins?|minutes?)\b/gi, "$1 minutes")
    .replace(/\b(\d+)\s*-?\s*(?:hrs?|hours?)\b/gi, "$1 hours")
    .replace(/\bpick[\s-]+up\b/gi, "pickup")
    .replace(/\s&\s/g, " and ")
    .replace(/\bincl\.?(?=\s|$)/gi, "included");
}

/** The copy a direction draws, as one string to look for facts in. */
export interface FactCopy {
  headline: string;
  subheadline?: string;
  cta?: string;
  footerLines: string[];
  footerStyle: "bar" | "text" | "none";
}

type CopyFields = Omit<FactCopy, "footerStyle">;

export function drawnText(copy: CopyFields): string {
  return [copy.headline, copy.subheadline, copy.cta, ...copy.footerLines]
    .filter(Boolean)
    .join(" \n ");
}

const FOOTER_JOIN = " · ";

/** One place a fact can be stated: a field, or a footer item read with the
 *  footer line it is drawn on. */
interface CopyPart {
  text: string;
  line: string;
}

/** Every field and every footer item of `copy`, each on its own. A string
 *  is split into its lines and its middle-dotted items. */
function copyParts(copy: string | CopyFields): CopyPart[] {
  const itemsOf = (line: string) =>
    line
      .split(/\s+[·•]\s+/)
      .map((text) => ({ text: text.trim(), line }))
      .filter((part) => part.text);
  if (typeof copy === "string") {
    return copy.split("\n").flatMap((line) => itemsOf(line.trim()));
  }
  return [
    ...[copy.headline, copy.subheadline, copy.cta]
      .filter((t): t is string => Boolean(t))
      .map((text) => ({ text, line: text })),
    ...copy.footerLines.flatMap(itemsOf),
  ];
}

/* Words compared as words: case, punctuation and the "&"/"incl." ways of
   writing them aside. */
function wordsOf(text: string): string {
  return meaningOf(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}₦$£€%@+]+/gu, " ")
    .trim();
}

/** Whether `part` holds `phrase` whole, as words. A leading article is
 *  not part of the fact: "First session is free" states "the first
 *  session is free" (round-7 eval, tutoring and retreat). */
function holdsWhole(phrase: string, part: string): boolean {
  const wanted = wordsOf(phrase).replace(/^(?:the|a|an) /, "");
  return wanted.length > 0 && ` ${wordsOf(part)} `.includes(` ${wanted} `);
}

function needsHold(needs: readonly string[], text: string): boolean {
  const copy = meaningOf(text);
  const lower = copy.toLowerCase();
  const numbers = numbersIn(copy);
  const times = timesIn(copy);
  const days = new Set(calendarNames(copy));
  const stems = contentStems(copy);
  return needs.every((need) => {
    if (need.startsWith("=")) return numbers.has(need.slice(1));
    if (need.startsWith("@")) return times.has(need.slice(1));
    if (need.startsWith("~")) return days.has(need.slice(1));
    if (need.startsWith("#"))
      return phoneStated(need.slice(1).split(","), copy);
    if (need.startsWith("^")) return stems.has(need.slice(1));
    if (need === "%daily") return EVERY_DAY.test(copy);
    return new RegExp(
      `(^|[^\\p{L}])${need.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      "u",
    ).test(lower);
  });
}

function statedIn(fact: BriefFact, part: CopyPart): boolean {
  /* A time printed on a phone's line reads as the phone's hours (round-6
     live critic: "Call 0705 919 2284 · 9am to 4pm" for class hours). */
  if (fact.kind === "time" && PHONE_LIKE.test(part.line)) return false;
  if (holdsWhole(fact.text, part.text)) return true;
  /* An offer or condition is its whole span: three words in four of "Free
     delivery to Lekki, Ajah and Ikoyi" lost Ikoyi (round-6 code critic). */
  if (fact.kind === "offer" || fact.kind === "condition") return false;
  if (fact.kind === "price") {
    /* Currency, amount and unit together: a bare "2,000" is never the
       price, nor "₦18,000" without "per split unit" (round-6 critics), nor
       "₦20" for "$20" (round-7 code critic). A price whose currency code
       cannot read is held only whole. */
    const amounts = moneyOf(fact.text);
    if (amounts.size === 0 || [...amounts].some((m) => m.startsWith("?|"))) {
      return false;
    }
    const drawn = moneyOf(part.text);
    if ([...amounts].some((amount) => !drawn.has(amount))) return false;
    return needsHold(fact.needs, part.text);
  }
  /* Clock times are read as minutes past midnight (timesIn), whatever
     their spelling; every other number keeps its place. */
  const clocked = fact.needs.some((n) => n.startsWith("@"));
  const numericDate = fact.kind === "date" && /\d\/\d/.test(fact.text);
  if (
    fact.kind !== "contact" &&
    !clocked &&
    !numericDate &&
    !numbersHeldInPlace(fact.text, part.text)
  ) {
    return false;
  }
  return needsHold(fact.needs, part.text);
}

/**
 * Whether `copy` states `fact`, literally and in one place: one field or
 * one footer item holds the brief's own words for it, or every part of it
 * ("₦4,500 a slice" or "N4500 a slice", "7am" or "07:00"). Oluwaseyi's
 * ruling (round 7): the same verifier decides every drop and merge, the
 * job's metrics and the eval's coverage gate, so no rule can count a fact
 * delivered that the design does not carry.
 *
 *  - A price is its currency, amount and unit in one place.
 *  - An offer or condition is its whole span.
 *  - A time never counts on a footer line holding a phone number.
 */
export function factStated(
  fact: BriefFact,
  copy: string | CopyFields,
): boolean {
  return copyParts(copy).some((part) => statedIn(fact, part));
}

/** The facts of `facts` that `copy` does not state. */
export function factsMissing(
  facts: readonly BriefFact[],
  copy: string | CopyFields,
): BriefFact[] {
  return facts.filter((fact) => !factStated(fact, copy));
}

/** What an item says: its content words and its numbers. A phone number
 *  is one thing said, never its digit groups: "0803 orders" and "555
 *  slices" above did not say "WhatsApp 0803 555 0142" (round-5 code
 *  critic). */
function said(raw: string): Set<string> {
  const out = new Set<string>();
  const text = meaningOf(raw).replace(
    new RegExp(PHONE_LIKE.source, "g"),
    (phone) => {
      out.add(`#${digitsOf(phone)}`);
      return " ";
    },
  );
  for (const t of timesIn(text)) out.add(`@${t}`);
  /* An amount with its currency is a price, never a count: "₦2,000 each"
     does not repeat "2,000 happy customers" (round-6 P1, kept by the
     meaning check too). */
  for (const amount of moneyIn(text)) out.add(`$${amount}`);
  /* A clock time is said by its minutes, never by "12pm" as a word or 12
     as a count: "12–6pm" and "12pm to 6pm" say the same thing. */
  const rest = text
    .replace(MONEY, " ")
    .replace(SHARED_SUFFIX, " ")
    .replace(CLOCK, " ");
  for (const s of contentStems(rest)) {
    if (!FILLER.has(s) && !isNumberWord(s)) out.add(s);
  }
  for (const n of numbersIn(rest)) out.add(`=${n}`);
  return out;
}

function within(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size === 0) return true;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

const UNIT_STEMS = contentStems(
  UNIT_NOUN.replace(/[()?:]/g, " ")
    .split("|")
    .map((w) => w.replace(/\\[a-z]|[^a-z]/gi, ""))
    .join(" "),
);

/* An amount with its currency: "₦4,500", "N4500", "NGN 4,500", "4,500
   naira", "$20", "GH₵50", "GHS 50", "KSh 300", "R250", "ZAR 250". Round-7
   code critic: only ₦, $, £ and € were read, so a Ghana price was "stated"
   by any count, and "$20" by "₦20". */
const CURRENCY_BEFORE: [RegExp, string][] = [
  [/^(?:₦|N|NGN)$/i, "ngn"],
  [/^(?:\$|USD|US\$)$/i, "usd"],
  [/^(?:£|GBP)$/i, "gbp"],
  [/^(?:€|EUR)$/i, "eur"],
  [/^(?:GH₵|GH¢|GHS|GH₵\.|₵)$/i, "ghs"],
  [/^(?:KSh|KES|Ksh\.?)$/i, "kes"],
  [/^(?:R|ZAR)$/, "zar"],
];
const CURRENCY_AFTER: [RegExp, string][] = [
  [/^(?:naira|ngn)$/i, "ngn"],
  [/^(?:cedis?|ghs)$/i, "ghs"],
  [/^(?:shillings?|kes)$/i, "kes"],
  [/^(?:rand|zar)$/i, "zar"],
  [/^(?:dollars?|usd)$/i, "usd"],
];
const MONEY =
  /(?<![\p{L}\d])(₦|GH₵|GH¢|₵|\$|£|€|US\$|(?:NGN|USD|GBP|EUR|GHS|KES|KSh|ZAR)(?=\s?\d)|N(?=\d)|R(?=\d))\s?(\d[\d,]*(?:\.\d+)?)(\s?k\b)?|(\d[\d,]*(?:\.\d+)?)\s?(naira|ngn|cedis?|ghs|shillings?|kes|rand|zar|dollars?|usd)\b/giu;

/** "currency|value" for every amount `text` states with a currency. */
function moneyOf(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(MONEY)) {
    let value = Number.parseFloat((m[2] ?? m[4] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    if (m[3]) value *= 1000;
    const sign = m[1] ?? m[5] ?? "";
    const table = m[1] ? CURRENCY_BEFORE : CURRENCY_AFTER;
    const currency = table.find(([re]) => re.test(sign.trim()))?.[1] ?? "?";
    found.add(`${currency}|${value}`);
  }
  return found;
}

function moneyIn(text: string): Set<string> {
  return new Set([...moneyOf(text)].map((m) => m.split("|")[1]));
}

/* A number read with the words either side of it: "Ages 8+" is 8 beside
   "ages" and "+", "8 seats" 8 beside "seats", "9-5" a range. The hour of
   "8pm", a street number or a day of the month has other neighbours, and
   never stands in for an age or a count (round-7 code critic, K17: "Doors
   open 8pm" stated "Ages 8+"). */
interface NumberInPlace {
  value: string;
  /** The other end of a range ("9-5", "5 to 12"), or null. */
  rangeTo: string | null;
  neighbours: Set<string>;
}

const PLACE_TOKEN = /\d[\d,]*(?:\.\d+)?|[\p{L}]+|[+%]/gu;
const NOT_A_NEIGHBOUR = new Set([
  "a",
  "an",
  "the",
  "of",
  "for",
  "only",
  "just",
]);

function neighbourOf(token: string): string {
  if (/^[+%]$/.test(token)) return token;
  const lower = token.toLowerCase();
  if (/^(?:am|pm)$/.test(lower)) return "@clock";
  const named = calendarNames(token);
  if (named.length > 0) return `~${named[0]}`;
  return stem(lower);
}

function numbersInPlace(text: string): NumberInPlace[] {
  const tokens = [...meaningOf(text).matchAll(PLACE_TOKEN)].map((m) => ({
    text: m[0],
    at: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
  const out: NumberInPlace[] = [];
  const asNumber = (t: string): string | null =>
    /^\d/.test(t)
      ? String(Number.parseFloat(t.replace(/,/g, "")))
      : t.toLowerCase() in NUMBER_WORDS
        ? String(NUMBER_WORDS[t.toLowerCase()])
        : null;
  const isNumber = (t: string) => asNumber(t) !== null;
  for (let i = 0; i < tokens.length; i += 1) {
    if (!isNumber(tokens[i].text)) continue;
    const value = asNumber(tokens[i].text) as string;
    let rangeTo: string | null = null;
    let last = i;
    /* "9am–5pm" is the range "9-5" with its clock words. */
    const clock = /^(?:am|pm)$/i.test(tokens[i + 1]?.text ?? "") ? 1 : 0;
    const next = tokens[i + 1 + clock];
    const gap = text.slice(
      tokens[i + clock].end,
      next?.at ?? tokens[i + clock].end,
    );
    if (next && isNumber(next.text) && /^\s?[-–—]\s?$/.test(gap)) {
      rangeTo = asNumber(next.text);
      last = i + 1 + clock;
    } else if (
      next?.text.toLowerCase() === "to" &&
      tokens[i + 2 + clock] &&
      isNumber(tokens[i + 2 + clock].text)
    ) {
      rangeTo = asNumber(tokens[i + 2 + clock].text);
      last = i + 2 + clock;
    }
    /* "8pm" is one token pair with no space: the clock word beside it. */
    const neighbours = new Set<string>();
    const look = (j: number, step: number) => {
      for (let k = j; k >= 0 && k < tokens.length; k += step) {
        const word = tokens[k].text.toLowerCase();
        if (isNumber(word)) return;
        if (NOT_A_NEIGHBOUR.has(word)) continue;
        neighbours.add(neighbourOf(tokens[k].text));
        return;
      }
    };
    look(i - 1, -1);
    look(last + 1, 1);
    out.push({ value, rangeTo, neighbours });
    i = last;
  }
  return out;
}

/** Whether every number of `fact` is in `part` as the fact has it: the
 *  same range, or beside one of the same neighbouring words. */
function numbersHeldInPlace(fact: string, part: string): boolean {
  const theirs = numbersInPlace(part);
  return numbersInPlace(fact).every((mine) =>
    theirs.some(
      (t) =>
        t.value === mine.value &&
        t.rangeTo === mine.rangeTo &&
        (mine.rangeTo !== null && mine.neighbours.size === 0
          ? true
          : [...mine.neighbours].some((n) => t.neighbours.has(n)) ||
            (mine.neighbours.size === 0 && t.neighbours.size === 0)),
    ),
  );
}

/** Whether a footer item is just the product's name: every word of the
 *  name, at most one more ("Handmade stoneware cups" for "stoneware
 *  cups"), and no number. */
export function isProductName(item: string, product: string): boolean {
  const name = said(product);
  const mine = said(item);
  if (name.size === 0 || mine.size === 0 || numbersIn(item).size > 0) {
    return false;
  }
  if (!within(name, mine)) return false;
  return [...mine].filter((s) => !name.has(s)).length <= 1;
}

/**
 * The footer items of `copy` that say nothing the rest of it does not: an
 * item whose every word and number the headline, subheadline or button
 * already carries ("Pickup from 7am" under "available from Monday, 7am
 * pickup"), read for meaning ("20-min" is "20-minute", "12–6pm" is "12pm to
 * 6pm"); a price whose amount the copy above already gives, with nothing
 * more than its unit ("₦4,500 a slice" under "₦4,500."); one another item
 * already says; or the product's name when the copy above names it.
 * Round-4 live critic: five of eleven directions repeated the subheadline
 * in the footer, and two printed the address twice.
 */
export function redundantFooterItems(copy: CopyFields, product = ""): string[] {
  const aboveText = [copy.headline, copy.subheadline, copy.cta]
    .filter(Boolean)
    .join(" ");
  const above = said(aboveText);
  const moneyAbove = moneyIn(aboveText);
  const productSaid = said(product);
  const productAbove = productSaid.size > 0 && within(productSaid, above);
  const items = copy.footerLines.flatMap((line) =>
    line.split(FOOTER_JOIN).map((item) => item.trim()),
  );
  const redundant: string[] = [];
  items.forEach((item, i) => {
    const mine = said(item);
    if (mine.size === 0) return;
    const repeatsAbove = within(mine, above);
    const money = moneyIn(item);
    const pricedAbove =
      money.size > 0 &&
      [...money].every((m) => moneyAbove.has(m)) &&
      [...mine].every(
        (s) =>
          above.has(s) ||
          UNIT_STEMS.has(s) ||
          (s.startsWith("$") && money.has(s.slice(1))),
      );
    const isProduct = productAbove && isProductName(item, product);
    const repeatsSibling = items.some((other, j) => {
      if (j === i || redundant.includes(other)) return false;
      const theirs = said(other);
      return within(mine, theirs) && (theirs.size > mine.size || j < i);
    });
    if (repeatsAbove || pricedAbove || isProduct || repeatsSibling) {
      redundant.push(item);
    }
  });
  return redundant;
}

function footerItems(lines: readonly string[]): number {
  return lines.flatMap((line) => line.split(FOOTER_JOIN)).filter(Boolean)
    .length;
}

function withoutItem<T extends FactCopy>(copy: T, item: string): T {
  const footerLines = copy.footerLines
    .map((line) =>
      line
        .split(FOOTER_JOIN)
        .map((i) => i.trim())
        .filter((i) => i !== item)
        .join(FOOTER_JOIN),
    )
    .filter(Boolean);
  return {
    ...copy,
    footerLines,
    footerStyle: footerLines.length > 0 ? copy.footerStyle : "none",
  };
}

/** `copy` without `item`, when that loses nothing: every brief fact it
 *  stated is still stated, and what a customer acts on in the item (a
 *  phone, price, time, date or place) is in one other place of the copy.
 *  The one test every drop passes (Oluwaseyi's ruling, round 7). */
export function droppedSafely<T extends FactCopy>(
  copy: T,
  item: string,
  facts: readonly BriefFact[],
): T | null {
  const trial = withoutItem(copy, item);
  const stated = (c: T) => facts.filter((f) => factStated(f, c)).length;
  if (stated(trial) < stated(copy)) return null;
  return detailHeldElsewhere(item, trial) ? trial : null;
}

function withoutRedundant<T extends FactCopy>(
  direction: T,
  product: string,
  facts: readonly BriefFact[],
): T {
  let current = direction;
  for (const item of redundantFooterItems(direction, product)) {
    current = droppedSafely(current, item, facts) ?? current;
  }
  return current;
}

/* What in an item a customer acts on: its phone numbers, money, times,
   numbers, days, months and the places it names. */
function hardDetailOf(item: string): Set<string> {
  const out = new Set<string>();
  for (const token of said(item)) if (/^[=@#]/.test(token)) out.add(token);
  for (const amount of moneyIn(item)) out.add(`$${amount}`);
  for (const name of calendarNames(item)) out.add(`~${name}`);
  for (const place of placesIn(item)) {
    for (const stem of contentStems(place)) out.add(`^${stem}`);
  }
  /* A handle, an email or a website is a contact with no digits, and a
     place after "to" or "for" is where the offer reaches (round-7 code
     critic, D1 to D4). */
  for (const contact of item.match(CONTACT_LITERAL) ?? []) {
    out.add(`^${contact.toLowerCase().replace(/^https?:\/\//, "")}`);
  }
  for (const m of item.matchAll(PLACE_AFTER_TO)) {
    for (const stem of contentStems(m[1])) out.add(`^${stem}`);
  }
  return out;
}

const CONTACT_LITERAL =
  /[\w.+-]+@[\w-]+\.[\w.]+|@[\w.]{2,}|(?:https?:\/\/)?(?:[\w-]+\.)+(?:com|ng|co|org|net|io|shop|store|africa|uk|gh|ke|za)(?:\/[\w/.-]*)?/gi;
const PLACE_AFTER_TO =
  /\b(?:to|for)\s+((?:[A-Z][\p{L}'’-]+)(?:\s+(?:[A-Z][\p{L}'’-]+|\d+))*)/gu;

/** Whether everything a customer acts on in `item` is in one other field
 *  or footer item of `copy` (which no longer holds `item`): "Pre-orders
 *  close Thursday 6pm" never goes on a model's reading that it repeats
 *  "order early", nor "pickup in Lekki Phase 1" as a button echo (round-6
 *  code critic, P4 and P5). */
export function detailHeldElsewhere(item: string, copy: CopyFields): boolean {
  const detail = hardDetailOf(item);
  if (detail.size === 0) return true;
  return copyParts(copy).some((part) =>
    [...detail].every((d) => partHolds(part.text, d)),
  );
}

function partHolds(text: string, d: string): boolean {
  if (hardDetailOf(text).has(d)) return true;
  if (!d.startsWith("^")) return false;
  return (
    contentStems(text).has(d.slice(1)) ||
    text.toLowerCase().includes(d.slice(1))
  );
}

/** Like detailHeldElsewhere, for a footer item a model's rewrite moved:
 *  each of its details may land in a different place ("₦58,000 — 20
 *  pieces" split into the subheadline and the footer, round-8 eval). */
export function detailHeldAcross(item: string, copy: CopyFields): boolean {
  const parts = copyParts(copy).map((p) => p.text);
  return [...hardDetailOf(item)].every((d) =>
    parts.some((text) => partHolds(text, d)),
  );
}

export interface FactCoverage {
  /** Every fact the brief states, the offering's name among them. */
  facts: string[];
  /** Per direction, the facts it states as delivered. */
  stated: string[][];
  /** Facts the model wrote into a direction that had left them out. */
  added: { direction: number; fact: string }[];
  /** Facts a direction does not state, and why. */
  leftOff: { direction: number; fact: string; reason: string }[];
  /** Footer items dropped as repeats of the copy above or of each other. */
  repeatsDropped: number;
}

/**
 * Footer items that mostly say again what the copy above says, dropped
 * only when that loses nothing (droppedSafely): every number, time and
 * phone of the item is above, at least half its words are, every brief
 * fact the direction stated is still stated, and what a customer acts on
 * in it is in one other place. Round-5 eval: a reader judged four in ten
 * directions to repeat themselves in the footer where no item was a
 * word-for-word repeat ("Yaba Studio" under "in Yaba", "Pickup · 7am" under
 * "pick up from 7am").
 */
export function withoutLooseRepeats<T extends FactCopy>(
  direction: T,
  facts: readonly BriefFact[],
): T {
  const above = said(
    [direction.headline, direction.subheadline, direction.cta]
      .filter(Boolean)
      .join(" "),
  );
  const aboveCopy = { ...direction, footerLines: [] };
  let current = direction;
  for (const item of direction.footerLines.flatMap((line) =>
    line.split(FOOTER_JOIN).map((i) => i.trim()),
  )) {
    const mine = [...said(item)];
    const hard = mine.filter((s) => /^[=@#]/.test(s));
    const words = mine.filter((s) => !/^[=@#]/.test(s));
    const wordsAbove = words.filter((w) => above.has(w)).length;
    const itsFacts = facts.filter((f) => factStated(f, item));
    /* Oluwaseyi's rule (round 6): a fact the headline, subheadline or
       button already states is left out of the footer. */
    const factsAbove =
      itsFacts.length > 0 && itsFacts.every((f) => factStated(f, aboveCopy));
    /* "S – L" under "sizes S to L": an item of letters too short to say
       anything is a fragment of copy above. */
    const saysNothing = mine.length === 0 && /\p{L}/u.test(item);
    /* "₦6,000 flight" beside "Three 150ml tasters for ₦6,000": an item that
       states no fact of its own, whose numbers the rest of the copy
       already gives (round-6 live run, cafe). */
    const elsewhere = said(
      [
        direction.headline,
        direction.subheadline,
        direction.cta,
        ...current.footerLines
          .flatMap((line) => line.split(FOOTER_JOIN).map((i) => i.trim()))
          .filter((other) => other !== item),
      ]
        .filter(Boolean)
        .join(" \n "),
    );
    const numbersElsewhere =
      itsFacts.length === 0 &&
      hard.length > 0 &&
      hard.every((h) => elsewhere.has(h));
    const repeats =
      factsAbove ||
      saysNothing ||
      numbersElsewhere ||
      (mine.length > 0 &&
        hard.every((h) => above.has(h)) &&
        wordsAbove * 2 >= words.length);
    if (!repeats) continue;
    current = droppedSafely(current, item, facts) ?? current;
  }
  return current;
}

/**
 * Every direction's footer without the items that only repeat the copy
 * above or another footer item, each dropped only when that loses nothing.
 * Code drops; it never writes (Oluwaseyi's ruling, round 7).
 */
export function dropFooterRepeats<T extends FactCopy>(
  directions: T[],
  facts: readonly BriefFact[],
  product = "",
): { directions: T[]; dropped: number } {
  let dropped = 0;
  const out = directions.map((original) => {
    /* One separator: "·" and "•" mixed in one footer read as two styles,
       and an item behind a "•" was never compared with the others (round-6
       live critic: "Free Wi-Fi" twice). */
    const direction = {
      ...original,
      footerLines: original.footerLines.map((line) =>
        line.replace(/\s+[•·]\s+/g, FOOTER_JOIN),
      ),
    };
    const kept = withoutLooseRepeats(
      withoutRedundant(direction, product, facts),
      facts,
    );
    dropped +=
      footerItems(direction.footerLines) - footerItems(kept.footerLines);
    return kept;
  });
  return { directions: out, dropped };
}

const PLACE =
  /\b(?:in|at|from|around|across|near|within)\s+(?:(?:our|the)\s+)?((?:[A-Z][\p{L}'’-]+)(?:,?\s+(?:[A-Z][\p{L}'’-]+))*)/gu;
/* Capitalised words after "in" or "at" that are not places: a language, a
   colour, a channel, a day or a month. */
const NOT_PLACES = new RegExp(
  `^(?:${[
    "whatsapp|instagram|facebook|tiktok|x|twitter|youtube|snapchat|linkedin",
    "monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|weekends",
    "january|february|march|april|may|june|july|august|september|october|november|december",
    "christmas|easter|eid|ramadan|sallah|valentine",
    "english|french|spanish|portuguese|arabic|yoruba|igbo|hausa|pidgin|swahili|twi|ga|ewe|zulu|xhosa|amharic|chinese|mandarin|german|italian",
    "black|white|tan|olive|navy|red|blue|green|gold|silver|pink|cream|grey|gray|brown|beige|ivory|indigo|rust|burgundy|teal|yellow|orange|purple|khaki|camel|maroon|coral|mint|lilac|lavender|charcoal|nude",
    "size|sizes|stock|store|stores|style|styles|person|season|time",
  ].join("|")})$`,
  "i",
);

/** Place names a brand profile puts something in or at ("Lekki, Lagos").
 *  A profile is the brand's own description, not a brief to be read. */
export function placesIn(text: string | null | undefined): string[] {
  const places: string[] = [];
  for (const m of (text ?? "").matchAll(PLACE)) {
    const words = m[1].split(/,\s+/).flatMap((part) => {
      const kept = part.split(/\s+/).filter((w) => !NOT_PLACES.test(w));
      return kept.length > 0 ? [kept.join(" ")] : [];
    });
    if (words.length > 0) places.push(words.join(", "));
  }
  return places;
}

/**
 * Where a KO scene should be set: the place the brief names (its read place
 * fact), else the one the brand profile does. Null when neither names one;
 * the scene is then left to the art director.
 */
export function brandSetting(
  facts: readonly BriefFact[],
  profile: (string | null | undefined)[],
): string | null {
  const fromBrief = facts.find((f) => f.kind === "place")?.text ?? null;
  const fromProfile = profile.map(placesIn).find((p) => p.length > 0)?.[0];
  if (fromBrief && fromProfile && !fromProfile.includes(fromBrief)) {
    return `${fromBrief}, ${fromProfile}`;
  }
  return fromProfile ?? fromBrief ?? null;
}

/**
 * What the subheadline says again from the headline or the button: one of
 * the same prices or numbers, or most of the headline's own words. Round-7
 * live critic: "A Tray for ₦13,500" over a subheadline giving ₦13,500
 * again, "Your first 3 rides are free" repeated word for word, "Maths &
 * Physics at Home" over "Home maths and physics tutoring". Every fact once.
 */
export function aboveRepeats(
  copy: Pick<FactCopy, "headline" | "subheadline" | "cta">,
): string[] {
  const sub = copy.subheadline?.trim();
  if (!sub) return [];
  const found: string[] = [];
  for (const [name, field] of [
    ["headline", copy.headline],
    ["button", copy.cta],
  ] as const) {
    if (!field?.trim()) continue;
    const money = [...moneyOf(field)].filter((m) => moneyOf(sub).has(m));
    if (money.length > 0) {
      found.push(`the subheadline repeats the ${name}'s price`);
      continue;
    }
    /* "one" and "two" are words more than counts ("for two", "One box"). */
    const numbers = numbersInPlace(field)
      .map((n) => n.value)
      .filter((v) => v !== "1" && v !== "2");
    const subNumbers = new Set(numbersInPlace(sub).map((n) => n.value));
    if (numbers.some((v) => subNumbers.has(v))) {
      found.push(`the subheadline repeats a number from the ${name}`);
      continue;
    }
    if (name !== "headline") continue;
    const words = [...contentStems(field)].filter((s) => !FILLER.has(s));
    const subWords = contentStems(sub);
    const shared = words.filter((w) => subWords.has(w)).length;
    if (words.length >= 2 && shared * 3 >= words.length * 2) {
      found.push("the subheadline says the headline again");
    }
  }
  return found;
}

/**
 * The direction without a subheadline that only says again what the
 * headline or button says, when dropping it loses no fact and no detail a
 * customer acts on. Code drops; it never rewrites (round 8: the writer
 * could not always fix "Your first 3 rides are free" said twice).
 */
export function withoutRepeatingSubheadline<T extends FactCopy>(
  direction: T,
  facts: readonly BriefFact[],
): T {
  const sub = direction.subheadline?.trim();
  if (!sub || aboveRepeats(direction).length === 0) return direction;
  const { subheadline: _sub, ...rest } = direction;
  const trial = rest as T;
  const stated = (copy: T) => facts.filter((f) => factStated(f, copy)).length;
  if (stated(trial) < stated(direction)) return direction;
  return detailHeldElsewhere(sub, trial) ? trial : direction;
}
