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

export interface BriefFact {
  kind: BriefFactKind;
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
    /* "11–2pm" runs from morning into afternoon. */
    const startPm = pm && start <= end && start !== 12;
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
  /** Every way of writing the number a design may use: the brief's own
   *  digits, with the country code, and with the trunk 0. */
  variants: string[];
}

/* "0803 555 0142 9-5" swallowed the hours into the number, and the number
   failed validation; the reader rarely hands over a span like that, but
   when it does the trailing words are dropped one at a time until the
   number reads. */
function phonesIn(text: string, region: CountryCode): PhoneSpan[] {
  let candidate = text;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const found = findPhoneNumbersInText(candidate, region).filter((f) =>
      f.number.isValid(),
    );
    if (found.length > 0) {
      return found.map((f) => {
        const national = String(f.number.nationalNumber);
        const forms = [
          `${f.number.countryCallingCode}${national}`,
          `0${national}`,
          national,
        ];
        const surface = text.slice(f.startsAt, f.endsAt);
        const own = digitsOf(surface);
        /* libphonenumber reads "08035550142, 9" as the number with an
           extension; the number is drawn and matched without it. */
        const written = forms.find((form) => own.startsWith(form)) ?? own;
        return {
          start: f.startsAt,
          end: f.startsAt + digitEnd(surface, written.length),
          variants: [...new Set([written, ...forms.slice(0, 2)])],
        };
      });
    }
    const shorter = candidate.replace(/[\s,;:]*\S+\s*$/, "");
    if (shorter === candidate || !shorter) break;
    candidate = shorter;
  }
  return [];
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
   or time that follows it. */
const AFTER_ADDRESS =
  /(?:,\s*|\s+(?:on|from|every)\s+)(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?s?\b|\d{1,2}(?:[:.]\d{2})?\s?(?:am|pm)\b|daily\b|weekdays?\b|weekends?\b).*$/i;

/* What follows a price and belongs to it: "for a set of four", "per
   slice", "a slice", "each", "per person". */
const PRICE_UNIT =
  /^\s*(?:(?:for|per)\s+(?:a\s+|an\s+|one\s+)?(?:(?:set|pack|box|bundle|pair|bag|tray|dozen)\s+of\s+)?[\p{L}\d-]+|a\s+[\p{L}-]+|an\s+[\p{L}-]+|each|apiece)\b/iu;

function priceWithUnit(brief: string, end: number): number {
  const after = PRICE_UNIT.exec(brief.slice(end));
  return after ? end + after[0].length : end;
}

const EVERY_DAY = /\b(daily|every ?day|7 days a week|seven days a week)\b/i;

/** What has to appear in a design for it to state `text` as a `kind`. */
export function needsFor(
  kind: BriefFactKind,
  text: string,
  region: CountryCode = "NG",
): string[] {
  const numbers = () => [...numbersIn(text)].map((n) => `=${n}`);
  const stems = (ignore: ReadonlySet<string> = FILLER) =>
    [...contentStems(text)]
      .filter((s) => !ignore.has(s) && !isNumberWord(s))
      .map((s) => `^${s}`);
  const days = () => [...new Set(calendarNames(text))].map((d) => `~${d}`);
  switch (kind) {
    case "contact": {
      const phones = phonesIn(text, region);
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
    case "price":
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
  }
}

export interface BriefFactRead {
  facts: BriefFact[];
  /** What the reader returned that is not the brief's own words, or not a
   *  usable fact, and why: logged and recorded, never drawn. */
  dropped: { text: string; why: string }[];
}

/** Where `text` sits in the brief, read as the brief's own words: exactly,
 *  else ignoring case and runs of spaces. */
function locate(brief: string, text: string): [number, number] | null {
  const exact = brief.indexOf(text);
  if (exact >= 0) return [exact, exact + text.length];
  const pattern = text
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  if (!pattern) return null;
  const m = new RegExp(pattern, "i").exec(brief);
  return m ? [m.index, m.index + m[0].length] : null;
}

function isKind(kind: string): kind is BriefFactKind {
  return (BRIEF_FACT_KINDS as readonly string[]).includes(kind);
}

/**
 * The reader's facts, held to the brief: every span must be the brief's own
 * words; a phone number must be a valid number in the brand's country, and
 * a contact span ends where its last number does; an address ends before
 * the day or time after it; a price keeps the unit or quantity that follows
 * it; the product itself is never a fact (it is the design's subject, and
 * drawn as a footer "fact" it read as a dump, round-4 live critic); a fact
 * inside another is dropped for the longer one. In the brief's order.
 */
export function settleBriefFacts(
  read: readonly ReadFact[],
  briefText: string,
  { region = "NG", product = "" }: { region?: CountryCode; product?: string },
): BriefFactRead {
  const brief = briefText ?? "";
  const dropped: BriefFactRead["dropped"] = [];
  const located: (BriefFact & { start: number; end: number })[] = [];
  const productStems = contentStems(product);
  for (const raw of read) {
    const said = (raw.text ?? "").trim().replace(/[\s.,;:!]+$/, "");
    if (!said) continue;
    if (!isKind(raw.kind)) {
      dropped.push({ text: said, why: `unknown kind "${raw.kind}"` });
      continue;
    }
    const at = locate(brief, said);
    if (!at) {
      dropped.push({ text: said, why: "not the brief's own words" });
      continue;
    }
    let [start, end] = at;
    const kind = raw.kind;
    if (kind === "contact") {
      const span = brief.slice(start, end);
      const phones = phonesIn(span, region);
      if (phones.length === 0 && PHONE_LIKE.test(span)) {
        dropped.push({ text: said, why: "not a valid phone number" });
        continue;
      }
      if (phones.length > 0)
        end = start + Math.max(...phones.map((p) => p.end));
    }
    if (kind === "place") {
      const span = brief.slice(start, end);
      const cut = AFTER_ADDRESS.exec(span);
      if (cut && cut.index > 0) end = start + cut.index;
    }
    if (kind === "price") end = priceWithUnit(brief, end);
    const text = brief
      .slice(start, end)
      .trim()
      .replace(/[\s,;:]+$/, "");
    const stems = [...contentStems(text)].filter((s) => !/^\d+$/.test(s));
    if (
      productStems.size > 0 &&
      stems.length > 0 &&
      stems.every((s) => productStems.has(s)) &&
      numbersIn(text).size === 0
    ) {
      dropped.push({ text, why: "the product itself, not a fact about it" });
      continue;
    }
    const needs = needsFor(kind, text, region);
    if (needs.length === 0) {
      dropped.push({ text, why: "nothing in it a design could state" });
      continue;
    }
    located.push({
      kind,
      text: kind === "day" || kind === "date" ? capitalise(text) : text,
      needs,
      start,
      end,
    });
  }
  located.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: typeof located = [];
  for (const fact of located) {
    const inside = kept.find((k) => fact.start >= k.start && fact.end <= k.end);
    if (inside) {
      dropped.push({ text: fact.text, why: `part of "${inside.text}"` });
      continue;
    }
    kept.push(fact);
  }
  return {
    facts: kept.map(({ start: _s, end: _e, ...fact }) => fact),
    dropped,
  };
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

/** Whether `copy` states `fact`: the brief's own words for it, or every
 *  part of it in any spelling ("₦4,500" or "N4500", "7am" or "07:00"). */
export function factStated(fact: BriefFact, copy: string): boolean {
  if (saysVerbatim(fact.text, copy)) return true;
  const lower = copy.toLowerCase();
  const numbers = numbersIn(copy);
  const times = timesIn(copy);
  const days = new Set(calendarNames(copy));
  const stems = contentStems(copy);
  return fact.needs.every((need) => {
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

/** The copy a direction draws, as one string to look for facts in. */
export interface FactCopy {
  headline: string;
  subheadline?: string;
  cta?: string;
  footerLines: string[];
  footerStyle: "bar" | "text" | "none";
}

export function drawnText(copy: Omit<FactCopy, "footerStyle">): string {
  return [copy.headline, copy.subheadline, copy.cta, ...copy.footerLines]
    .filter(Boolean)
    .join(" \n ");
}

/** The facts of `facts` that `copy` does not state. */
export function factsMissing(
  facts: readonly BriefFact[],
  copy: string,
): BriefFact[] {
  return facts.filter((fact) => !factStated(fact, copy));
}

const FOOTER_JOIN = " · ";

/** What an item says: its content words and its numbers. */
function said(text: string): Set<string> {
  const out = new Set<string>();
  for (const s of contentStems(text)) {
    if (!FILLER.has(s) && !isNumberWord(s)) out.add(s);
  }
  for (const n of numbersIn(text)) out.add(`=${n}`);
  for (const t of timesIn(text)) out.add(`@${t}`);
  return out;
}

function within(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size === 0) return true;
  for (const value of a) if (!b.has(value)) return false;
  return true;
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
 * pickup"), one another item already says, or the product's name when the
 * copy above names it. Round-4 live critic: five of eleven directions
 * repeated the subheadline in the footer, and two printed the address twice.
 */
export function redundantFooterItems(
  copy: Omit<FactCopy, "footerStyle">,
  product = "",
): string[] {
  const above = said(
    [copy.headline, copy.subheadline, copy.cta].filter(Boolean).join(" "),
  );
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
    const isProduct = productAbove && isProductName(item, product);
    const repeatsSibling = items.some((other, j) => {
      if (j === i || redundant.includes(other)) return false;
      const theirs = said(other);
      return within(mine, theirs) && (theirs.size > mine.size || j < i);
    });
    if (repeatsAbove || isProduct || repeatsSibling) redundant.push(item);
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
 * left off and recorded with that reason.
 */
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
    const direction = withoutRedundant(original, product);
    coverage.repeatsDropped +=
      footerItems(original.footerLines) - footerItems(direction.footerLines);
    const missing = factsMissing(facts, drawnText(direction));
    if (missing.length === 0) {
      coverage.stated.push(facts.map((f) => f.text));
      return direction;
    }
    const lines = [...direction.footerLines];
    const touched = new Set<number>();
    const fitted: BriefFact[] = [];
    for (const fact of missing) {
      const item = capitalise(fact.text);
      const roomOn = () => {
        for (let j = lines.length - 1; j >= 0 && item.length <= limit; j -= 1) {
          if (`${lines[j]}${FOOTER_JOIN}${item}`.length <= limit) return j;
        }
        return -1;
      };
      let at = roomOn();
      /* A full footer gives up a line of its own words that states none of
         the brief's facts before a fact is left off (round-5 eval: the
         address and "apron and starter" were left off under three lines
         of the model's). */
      if (at < 0 && lines.length >= MAX_FOOTER_LINES && item.length <= limit) {
        const spare = lines.findLastIndex(
          (line, j) =>
            !touched.has(j) && facts.every((f) => !factStated(f, line)),
        );
        if (spare >= 0) {
          lines.splice(spare, 1);
          const shifted = [...touched].map((j) => (j > spare ? j - 1 : j));
          touched.clear();
          for (const j of shifted) touched.add(j);
          at = roomOn();
        }
      }
      if (at >= 0) {
        lines[at] = `${lines[at]}${FOOTER_JOIN}${item}`;
      } else if (item.length <= limit && lines.length < MAX_FOOTER_LINES) {
        at = lines.push(item) - 1;
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
    coverage.stated.push(
      facts
        .filter((f) => !missing.includes(f) || fitted.includes(f))
        .map((f) => f.text),
    );
    if (fitted.length === 0) return direction;
    for (const j of [...touched].sort((x, y) => x - y)) {
      coverage.added.push({ direction: index, line: lines[j] });
    }
    return withoutRedundant(
      {
        ...direction,
        footerLines: lines,
        footerStyle:
          direction.footerStyle === "none" ? "text" : direction.footerStyle,
      },
      product,
    );
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
