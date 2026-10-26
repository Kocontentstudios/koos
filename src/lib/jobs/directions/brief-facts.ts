import {
  type CountryCode,
  findPhoneNumbersInText,
} from "libphonenumber-js/max";
import { MAX_FOOTER_LINES } from "@/lib/design/render/footer";
import { calendarNames, NUMBER_WORDS } from "./claims";
import { COPY_LIMITS } from "./schema";
import { contentStems } from "./text-overlap";

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
export type CoverKind = BriefFactKind | "person";

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
      const times = [...timesIn(text)].map((t) => `@${t}`);
      return times.length > 0 ? times : numbers();
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

/* What a span after a contact's number says by itself, when it says
   anything a customer acts on: the hours or a count the reader glued to
   the number. */
function kindOfRemainder(text: string): BriefFactKind | null {
  if (timesIn(text).size > 0) return "time";
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

const CHANNEL_BEFORE =
  /\b(?:whatsapp|call(?:\s+or\s+whatsapp)?|text|phone|tel|sms|mobile|ring|dm)\b(?:\s+(?:us|me))?(?:\s+(?:on|at))?[\s:.-]*$/i;

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

  const keep = (kind: BriefFactKind, start: number, end: number) => {
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
    const lead = CHANNEL_BEFORE.exec(
      brief.slice(Math.max(0, phone.start - 30), phone.start),
    );
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

/* The brief's own words, whole: "4,500" inside "45,000" is not them. */
function saysVerbatim(phrase: string, copy: string): boolean {
  const flat = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
  const wanted = flat(phrase);
  if (!wanted) return false;
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`,
    "u",
  ).test(flat(copy));
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
    .replace(/\b(\d+)\s*-?\s*(?:hrs?|hours?)\b/gi, "$1 hours");
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

/** The fields above the footer, and each footer item on its own. A string
 *  is read as fields only, every line above the footer. */
function copyParts(copy: string | CopyFields): {
  above: string[];
  items: string[];
} {
  if (typeof copy === "string") {
    return { above: copy.split("\n").map((l) => l.trim()), items: [] };
  }
  return {
    above: [copy.headline, copy.subheadline, copy.cta].filter(
      (t): t is string => Boolean(t),
    ),
    items: copy.footerLines.flatMap((line) =>
      line.split(FOOTER_JOIN).map((item) => item.trim()),
    ),
  };
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

/**
 * Whether `copy` states `fact`: the brief's own words for it, or every part
 * of it in any spelling ("₦4,500" or "N4500", "7am" or "07:00", "20-min" or
 * "20-minute").
 *
 * A price with a unit is stated when one field or footer item gives the
 * number with its unit, or the copy above the footer gives the number (a
 * headline price is the price, and drawing it again in the footer read as
 * a repeat, round-5 live critic). In the footer the number alone, with the
 * unit somewhere else, is a price detached from what it buys ("₦35,000"
 * beside "8 seats").
 */
export function factStated(
  fact: BriefFact,
  copy: string | CopyFields,
): boolean {
  const text = typeof copy === "string" ? copy : drawnText(copy);
  if (saysVerbatim(fact.text, text)) return true;
  const numbers = fact.needs.filter((n) => n.startsWith("="));
  const unit = fact.needs.filter((n) => n.startsWith("^"));
  if (fact.kind === "price" && numbers.length > 0 && unit.length > 0) {
    const { above, items } = copyParts(copy);
    if ([...above, ...items].some((part) => needsHold(fact.needs, part))) {
      return true;
    }
    return typeof copy !== "string" && needsHold(numbers, above.join(" \n "));
  }
  return needsHold(fact.needs, text);
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
  /* A clock time is said by its minutes, never by "12pm" as a word or 12
     as a count: "12–6pm" and "12pm to 6pm" say the same thing. */
  const rest = text.replace(SHARED_SUFFIX, " ").replace(CLOCK, " ");
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

const MONEY =
  /(?:[₦$£€]\s?|\bN(?=\d))(\d[\d,]*(?:\.\d+)?)(\s?k\b)?|(\d[\d,]*(?:\.\d+)?)\s?(?:naira|ngn)\b/gi;

function moneyIn(text: string): Set<string> {
  const values = new Set<string>();
  for (const m of text.matchAll(MONEY)) {
    let value = Number.parseFloat((m[1] ?? m[3] ?? "").replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    if (m[2]) value *= 1000;
    values.add(String(value));
  }
  return values;
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
          (s.startsWith("=") && money.has(s.slice(1))),
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

function withoutRedundant<T extends FactCopy>(
  direction: T,
  product: string,
): T {
  const redundant = new Set(redundantFooterItems(direction, product));
  if (redundant.size === 0) return direction;
  const footerLines = direction.footerLines
    .map((line) =>
      line
        .split(FOOTER_JOIN)
        .map((item) => item.trim())
        .filter((item) => !redundant.has(item))
        .join(FOOTER_JOIN),
    )
    .filter(Boolean);
  return {
    ...direction,
    footerLines,
    footerStyle: footerLines.length > 0 ? direction.footerStyle : "none",
  };
}

/* A footer line coverage may give up for a fact: never one with a phone, a
   price, a time or a date in it (round-5 code critic: the model's own
   "WhatsApp 0803 555 0142 to reserve" was spliced out for the address). */
function holdsActionableDetail(line: string): boolean {
  return (
    PHONE_LIKE.test(line) ||
    moneyIn(line).size > 0 ||
    /\b(?:free|%)/i.test(line) ||
    timesIn(line).size > 0 ||
    calendarNames(line).length > 0 ||
    /\b\d{1,2}\/\d{1,2}\b/.test(line)
  );
}

export interface FactCoverage {
  /** Every hard fact the brief states. */
  facts: string[];
  /** Per direction, the facts it states after coverage. */
  stated: string[][];
  /** Facts drawn into a direction's footer because it left them out. */
  added: { direction: number; line: string }[];
  /** Facts a direction still does not state, and why. */
  leftOff: { direction: number; fact: string; reason: string }[];
  /** Footer items dropped as repeats of the copy above or of each other. */
  repeatsDropped: number;
}

/**
 * Draws every brief fact a direction left out into its footer, so whichever
 * design the client picks can be acted on, after dropping footer items that
 * only repeat (redundantFooterItems). A fact joins an existing footer line
 * with a middle dot when it fits there (the last first), so a count is never
 * stranded on a line of its own; otherwise it starts a new line while there
 * is room. A fact that does not fit anywhere, or is longer than a line, is
 * left off and recorded with that reason. What each direction states is
 * counted on the footer as it is finally drawn.
 */
/**
 * Footer items that mostly say again what the copy above says, dropped
 * only when nothing the brief gives goes with them: every number, time and
 * phone of the item is above, at least half its words are, and each brief
 * fact the direction stated is still stated without it. Round-5 eval: a
 * reader judged four in ten directions to repeat themselves in the footer
 * where no item was a word-for-word repeat ("Yaba Studio" under "in
 * Yaba", "Pickup · 7am" under "pick up from 7am").
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
  const stated = (copy: T) =>
    facts.filter((f) => factStated(f, copy)).map((f) => f.text);
  const before = stated(direction);
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
    const repeats =
      factsAbove ||
      (mine.length > 0 &&
        hard.every((h) => above.has(h)) &&
        wordsAbove * 2 >= words.length);
    if (!repeats) continue;
    const footerLines = current.footerLines
      .map((line) =>
        line
          .split(FOOTER_JOIN)
          .map((i) => i.trim())
          .filter((i) => i !== item)
          .join(FOOTER_JOIN),
      )
      .filter(Boolean);
    const trial = {
      ...current,
      footerLines,
      footerStyle: footerLines.length > 0 ? current.footerStyle : "none",
    } as T;
    if (stated(trial).length === before.length) current = trial;
  }
  return current;
}

export function coverBriefFacts<T extends FactCopy>(
  directions: T[],
  facts: readonly BriefFact[],
  product = "",
): { directions: T[]; coverage: FactCoverage } {
  const coverage: FactCoverage = {
    facts: facts.map((f) => f.text),
    stated: [],
    added: [],
    leftOff: [],
    repeatsDropped: 0,
  };
  const limit = COPY_LIMITS.footerLine;
  const covered = directions.map((original, index) => {
    const direction = withoutLooseRepeats(
      withoutRedundant(original, product),
      facts,
    );
    coverage.repeatsDropped +=
      footerItems(original.footerLines) - footerItems(direction.footerLines);
    const missing = factsMissing(facts, direction);
    if (missing.length === 0) {
      coverage.stated.push(facts.map((f) => f.text));
      return direction;
    }
    const lines = [...direction.footerLines];
    let subheadline = "";
    const touched = new Set<number>();
    const fitted: BriefFact[] = [];
    for (const fact of missing) {
      /* "stillwater.ng" and "@cake.ng" are written as the brief writes
         them: capitalised, a web address reads as a typo. */
      const item = fact.kind === "contact" ? fact.text : capitalise(fact.text);
      const roomOn = () => {
        for (let j = lines.length - 1; j >= 0 && item.length <= limit; j -= 1) {
          if (`${lines[j]}${FOOTER_JOIN}${item}`.length <= limit) return j;
        }
        return -1;
      };
      let at = roomOn();
      /* A full footer gives up a line of its own words that states none of
         the brief's facts and holds nothing a customer acts on before a
         fact is left off (round-5 eval: the address and "apron and
         starter" were left off under three lines of the model's). */
      if (at < 0 && lines.length >= MAX_FOOTER_LINES && item.length <= limit) {
        const spare = lines.findLastIndex(
          (line, j) =>
            !touched.has(j) &&
            !holdsActionableDetail(line) &&
            facts.every((f) => !factStated(f, line)),
        );
        if (spare >= 0) {
          lines.splice(spare, 1);
          const shifted = [...touched].map((j) => (j > spare ? j - 1 : j));
          touched.clear();
          for (const j of shifted) touched.add(j);
          at = roomOn();
        }
      }
      /* A direction with no subheadline has a line of room above the
         footer: a fact the full footer cannot take goes there (round-6
         live run: the named chocolatier left off a hero card whose footer
         held three lines of facts). */
      const above = subheadline || direction.subheadline || "";
      /* A fact is said in a sentence of the subheadline when it has room,
         rather than left off (round-6 eval: the ceramicist and a
         masterclass's address left off under three lines of facts). */
      const lead = above ? `${above.replace(/[\s.]+$/, "")}. ${item}.` : item;
      if (at >= 0) {
        lines[at] = `${lines[at]}${FOOTER_JOIN}${item}`;
      } else if (item.length <= limit && lines.length < MAX_FOOTER_LINES) {
        at = lines.push(item) - 1;
      } else if (lead.length <= COPY_LIMITS.subheadline) {
        subheadline = lead;
        fitted.push(fact);
        continue;
      } else {
        coverage.leftOff.push({
          direction: index,
          fact: fact.text,
          reason:
            item.length > limit
              ? "longer than a footer line"
              : "the footer has no room left for it",
        });
        continue;
      }
      touched.add(at);
      fitted.push(fact);
    }
    if (fitted.length === 0) {
      coverage.stated.push(
        facts.filter((f) => factStated(f, direction)).map((f) => f.text),
      );
      return direction;
    }
    const drawn = withoutLooseRepeats(
      withoutRedundant(
        {
          ...direction,
          ...(subheadline ? { subheadline } : {}),
          footerLines: lines,
          footerStyle:
            direction.footerStyle === "none" ? "text" : direction.footerStyle,
        },
        product,
      ),
      facts,
    );
    for (const j of [...touched].sort((x, y) => x - y)) {
      if (drawn.footerLines.includes(lines[j])) {
        coverage.added.push({ direction: index, line: lines[j] });
      }
    }
    /* Counted after the last repeat is dropped: a fact counted when added
       and then dropped as a repeat was reported delivered (round-5 code
       critic). */
    const stated = facts.filter((f) => factStated(f, drawn));
    coverage.stated.push(stated.map((f) => f.text));
    for (const fact of fitted) {
      if (!stated.includes(fact)) {
        coverage.leftOff.push({
          direction: index,
          fact: fact.text,
          reason: "dropped from the footer as a repeat",
        });
      }
    }
    return drawn;
  });
  return { directions: covered, coverage };
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
