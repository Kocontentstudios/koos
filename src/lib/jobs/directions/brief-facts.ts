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
 * a WhatsApp number, and both delivered designs dropped four of them: an
 * event post a parent cannot act on. Every fact found here must be drawn on
 * every direction, or the job records why it was left off.
 *
 * The readers are English, like the rest of the claim checks (spec,
 * "Written to length, only the brief's facts").
 */

export type BriefFactKind =
  | "day"
  | "time"
  | "price"
  | "age"
  | "place"
  | "contact"
  | "quantity"
  | "inclusion"
  | "product";

export interface BriefFact {
  kind: BriefFactKind;
  /** The brief's own words for it, which is what gets drawn when a
   *  direction left it out. */
  text: string;
  /** What has to appear for the fact to count as stated. */
  needs: string[];
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

/* "6.30pm" is half past six, not 30pm (round-3 code critic), and "07:00"
   with no am or pm is a 24-hour clock. */
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

const WEEKDAY = "(?:mon|tues|wednes|thurs|fri|satur|sun)days?";
const WEEKDAY_SHORT = "(?:Mon|Tues?|Wed|Thu(?:rs?)?|Fri|Sat|Sun)";
const MONTH =
  "(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)";
const ORDINAL = "(?:st|nd|rd|th)?";
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

/* "Sunday 9 November" is one date, not a Sunday and a November. */
const DATE = new RegExp(
  `\\b(?:(${WEEKDAY}|${WEEKDAY_SHORT}),?\\s+)?(?:the\\s+)?(\\d{1,2})${ORDINAL}(?:\\s+of)?\\s+(${MONTH})\\b|\\b(?:(${WEEKDAY}|${WEEKDAY_SHORT}),?\\s+)?(${MONTH})\\.?\\s+(\\d{1,2})${ORDINAL}\\b`,
  "giu",
);
const NUMERIC_DATE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/g;
const DAY_RANGE = new RegExp(
  `\\b(${WEEKDAY}|${WEEKDAY_SHORT})\\s*(?:to|through|until|till|[-–—])\\s*(${WEEKDAY}|${WEEKDAY_SHORT})\\b`,
  "giu",
);
const DAY_WORD = new RegExp(
  `\\b(?:(?:this|next|every)\\s+)?(?:${WEEKDAY}|weekends?|weekdays?)\\b`,
  "giu",
);

const PRICE =
  /(?:₦|\bNGN\s?|\bN(?=\d)|\$|£|€)\s?\d[\d,]*(?:\.\d+)?k?\b|\b\d[\d,]*(?:\.\d+)?k?\s?(?:naira|ngn)\b/gi;
const PERCENT_OFF = /\b\d{1,3}(?:\.\d+)?\s?(?:%|percent)(?:\s+off)?/gi;
const UNIT =
  "ml|cl|l|litres?|liters?|kg|g|grams?|pieces?|pcs|spots?|seats?|slots?|places?|tickets?|bottles?|boxes?|packs?|slices?|cups?|plates?|sessions?|classes?|weeks?|hours?|days?|nights?|people|persons?|guests?|kids?|child(?:ren)?|throws?|cushions?|items?|flavours?|flavors?|heads?";
/* "Price 4500 per slice" names a price with no currency sign. */
const WORDED_PRICE = new RegExp(
  `\\b(?:price[sd]?|costs?|fees?)\\s*(?:is|of|:)?\\s*\\d[\\d,]*(?:\\.\\d+)?k?\\b(?![:.]?\\d|\\s?(?:am|pm|%))|\\b\\d[\\d,]{2,}(?:\\.\\d+)?k?\\s+(?:per|a|each)\\s+(?:${UNIT})\\b`,
  "gi",
);
const TIME_SPAN =
  /\b\d{1,2}(?:[:.]\d{2})?\s?(?:am|pm)(?:\s?(?:[-–—]|to|until)\s?\d{1,2}(?:[:.]\d{2})?\s?(?:am|pm))?\b|\b(?:[01]?\d|2[0-3]):[0-5]\d(?:\s?(?:[-–—]|to|until)\s?(?:[01]?\d|2[0-3]):[0-5]\d)?\b|\b(?:before|after|by|until)?\s?(?:noon|midday|midnight)\b/gi;
const AGE =
  /\bage[sd]?\s*\d{1,2}\s*(?:[-–—]|to)\s*\d{1,2}\b|\bage[sd]?\s*\d{1,2}\s*(?:\+|(?:and|or)\s+(?:up|over|above|older)\b)|\b\d{1,2}\s*(?:[-–—]|to)\s*\d{1,2}\s*(?:years?|yrs?)(?:[- ]olds?)?\b|\b\d{1,2}\s*(?:years?|yrs?)(?:[- ]olds?)?\s*(?:and|or)\s+(?:up|over|above|older)\b|\b(?:under|over)[- ]\d{1,2}s?\b|\(\d{1,2}\+\)/gi;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g;
const URL =
  /\b(?:https?:\/\/)?(?:[\w-]+\.)+(?:com|ng|co|org|io|net|shop|store|africa)(?:\/[\w/-]*)?\b/gi;
const HANDLE = /(?<![\w.])@[\w.]{2,}\b/g;
const CHANNEL = /\b(whatsapp|instagram dm|dm us|text us|call us)\b/gi;
const STREET =
  "Road|Rd|Street|St|Way|Avenue|Ave|Close|Crescent|Cres|Drive|Lane|Boulevard|Blvd|Estate|Plaza|Mall|Square|Expressway|Highway|Court|Terrace|Parade";
/* "14 Bourdillon Road, Ikoyi": an address needs no "in" or "at" in front of
   it (round-3 code critic). */
const ADDRESS = new RegExp(
  `\\b\\d{1,5}[A-Za-z]?,?\\s+(?:[A-Z][\\p{L}'’.-]*\\s+){0,4}?(?:${STREET})\\b(?:,\\s*[A-Z][\\p{L}'’-]+(?:\\s+[A-Z][\\p{L}'’-]+)?)?`,
  "gu",
);
const PLACE =
  /\b(?:in|at|from|around|across|near|within)\s+(?:(?:our|the)\s+)?((?:[A-Z][\p{L}'’-]+)(?:,?\s+(?:[A-Z][\p{L}'’-]+))*)/gu;
const QUANTITY = new RegExp(
  `\\b(\\d+|${Object.keys(NUMBER_WORDS).join("|")})\\s?(?:new\\s+)?(${UNIT})\\b(?:\\s+(?:and|&)\\s+(?:${UNIT})\\b)?`,
  "gi",
);
const INCLUSION =
  /\b(?:all\s+)?((?:[\p{L}-]+)(?:(?:\s+and\s+|\s+&\s+|\s+)[\p{L}-]+){0,4})\s+(?:are\s+|is\s+)?included\b|\bincludes?\s+([\p{L}\s,&-]{3,60}?)(?=[.;!]|$)/giu;

/* Capitalised words that follow "in" or "at" but are not places: a
   language ("taught in Yoruba"), a colour ("comes in Black, Tan and Olive"),
   a channel, a day or a month. */
const NOT_PLACES = new RegExp(
  `^(?:${[
    "whatsapp|instagram|facebook|tiktok|x|twitter|youtube|snapchat|linkedin",
    "monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|weekends",
    "january|february|march|april|may|june|july|august|september|october|november|december",
    "christmas|easter|eid|ramadan|sallah|valentine",
    "english|french|spanish|portuguese|arabic|yoruba|igbo|hausa|pidgin|swahili|twi|ga|ewe|zulu|xhosa|amharic|chinese|mandarin|german|italian",
    "black|white|tan|olive|navy|red|blue|green|gold|silver|pink|cream|grey|gray|brown|beige|ivory|indigo|rust|burgundy|teal|yellow|orange|purple|khaki|camel|maroon|coral|mint|lilac|lavender|charcoal|nude",
    "size|sizes|stock|store|stores|style|styles|person|stores|season|time|stock",
  ].join("|")})$`,
  "i",
);

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function digits(text: string): string {
  return text.replace(/\D/g, "");
}

function monthKey(name: string): string {
  return name.toLowerCase().slice(0, 3);
}

function weekdayKey(name: string): string {
  const lower = name.toLowerCase();
  const full = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];
  return full.find((day) => day.startsWith(lower.slice(0, 3))) ?? lower;
}

/* Day-first everywhere but the United States, where 3/11 is March 11. */
const MONTH_FIRST: ReadonlySet<string> = new Set(["US", "PH", "FM", "MH"]);

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

export interface BriefFactOptions {
  /** Where the brand's phone numbers are dialled from (brandRegion). */
  region?: CountryCode;
  /** The brief's product, as the plate is checked for it. A direction that
   *  never names what it sells cannot be acted on either. */
  product?: string;
}

type Located = BriefFact & { at: number; end: number };

/** The brief's hard facts, each once, in the order the brief gives them. */
export function briefFacts(
  briefText: string,
  { region = "NG", product = "" }: BriefFactOptions = {},
): BriefFact[] {
  const text = briefText ?? "";
  const facts: Located[] = [];
  const taken: [number, number][] = [];
  const free = (start: number, end: number) =>
    !taken.some(([s, e]) => start < e && end > s);
  const add = (
    kind: BriefFactKind,
    start: number,
    surface: string,
    needs: string[],
  ) => {
    const end = start + surface.length;
    if (needs.length === 0 || !free(start, end)) return false;
    taken.push([start, end]);
    const text = surface.trim();
    facts.push({
      kind,
      text: kind === "day" ? capitalise(text) : text,
      needs,
      at: start,
      end,
    });
    return true;
  };
  const each = (
    pattern: RegExp,
    kind: BriefFactKind,
    needsOf: (m: RegExpMatchArray) => string[],
  ) => {
    for (const m of text.matchAll(pattern)) {
      add(kind, m.index ?? 0, m[0].replace(/[\s,]+$/, ""), needsOf(m));
    }
  };
  const values = (m: RegExpMatchArray) =>
    [...numbersIn(m[0])].map((n) => `=${n}`);

  each(EMAIL, "contact", (m) => [m[0].toLowerCase()]);
  each(URL, "contact", (m) => [m[0].toLowerCase().replace(/^https?:\/\//, "")]);
  each(HANDLE, "contact", (m) => [m[0].toLowerCase()]);
  each(DATE, "day", (m) => {
    const weekday = m[1] ?? m[4];
    const day = m[2] ?? m[6];
    const month = m[3] ?? m[5];
    return [
      ...(weekday ? [`~${weekdayKey(weekday)}`] : []),
      `=${Number(day)}`,
      `~${monthKey(month)}`,
    ];
  });
  for (const m of text.matchAll(NUMERIC_DATE)) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    const [day, month] = MONTH_FIRST.has(region) ? [b, a] : [a, b];
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    add("day", m.index ?? 0, m[0], [`=${day}`, `~${MONTH_ORDER[month - 1]}`]);
  }
  each(PRICE, "price", values);
  each(PERCENT_OFF, "price", values);
  each(WORDED_PRICE, "price", (m) => {
    const amount = /\d[\d,]*(?:\.\d+)?k?/.exec(m[0]);
    return amount ? [...numbersIn(amount[0])].map((n) => `=${n}`) : [];
  });
  each(AGE, "age", values);
  each(TIME_SPAN, "time", (m) => [...timesIn(m[0])].map((t) => `@${t}`));
  each(QUANTITY, "quantity", (m) => [...numbersIn(m[1])].map((n) => `=${n}`));
  each(ADDRESS, "place", (m) => [
    ...values(m).slice(0, 1),
    ...[...contentStems(m[0].replace(/\d+/g, " "))].map((s) => `^${s}`),
  ]);
  phoneFacts(text, region, taken).forEach(({ start, surface, national }) => {
    add("contact", start, surface, [`#${national}`]);
  });
  each(CHANNEL, "contact", (m) => [m[1].toLowerCase()]);
  each(DAY_RANGE, "day", (m) => [
    `~${weekdayKey(m[1])}`,
    `~${weekdayKey(m[2])}`,
  ]);
  each(DAY_WORD, "day", (m) => [
    `~${calendarNames(m[0])[0] ?? m[0].toLowerCase()}`,
  ]);
  each(INCLUSION, "inclusion", (m) =>
    [...contentStems(m[1] ?? m[2])].map((s) => `^${s}`),
  );
  for (const name of new Set(calendarNames(text))) {
    if (facts.some((f) => f.needs.includes(`~${name}`))) continue;
    const word = new RegExp(
      `\\b${/\s/.test(name) ? name : `${name.slice(0, 3)}\\p{L}*`}`,
      "iu",
    ).exec(text);
    const at = word?.index ?? text.length;
    facts.push({
      kind: "day",
      text: capitalise(word?.[0] ?? name),
      needs: [`~${name}`],
      at,
      end: at + (word?.[0].length ?? 0),
    });
  }
  for (const m of text.matchAll(PLACE)) {
    const start = (m.index ?? 0) + m[0].indexOf(m[1]);
    const words = m[1]
      .split(/,?\s+/)
      .filter((w) => !NOT_PLACES.test(w))
      .filter((w) => {
        const at = text.indexOf(w, start);
        return free(at, at + w.length);
      });
    if (words.length === 0) continue;
    const at = text.indexOf(words[0], start);
    add(
      "place",
      at,
      words.join(" "),
      words.map((w) => w.toLowerCase()),
    );
  }
  const productFact = productFactOf(text, product);
  if (productFact) facts.push(productFact);
  facts.sort((a, b) => a.at - b.at);
  return mergeChannelAndNumber(text, facts).map(
    ({ at: _at, end: _end, ...fact }) => fact,
  );
}

/* A phone number is read by libphonenumber, after every time, price and
   count has claimed its digits: a hand pattern glued "08035550142 7" out of
   "Call 08035550142 7am to 7pm" (round-3 code critic). */
function phoneFacts(
  text: string,
  region: CountryCode,
  taken: readonly [number, number][],
): { start: number; surface: string; national: string }[] {
  let masked = text;
  for (const [start, end] of taken) {
    masked =
      masked.slice(0, start) + " ".repeat(end - start) + masked.slice(end);
  }
  return findPhoneNumbersInText(masked, region).map((found) => ({
    start: found.startsAt,
    surface: text.slice(found.startsAt, found.endsAt),
    national: String(found.number.nationalNumber),
  }));
}

function productFactOf(text: string, product: string): Located | null {
  const name = product.trim();
  const stems = [...contentStems(name)];
  if (!name || stems.length === 0) return null;
  const at = text.toLowerCase().indexOf(name.toLowerCase());
  return {
    kind: "product",
    text: capitalise(name),
    needs: stems.map((s) => `^${s}`),
    at: at < 0 ? -1 : at,
    end: at < 0 ? -1 : at + name.length,
  };
}

/* "WhatsApp 0803 555 0142" is one way to reach the client, not two facts
   to be drawn apart. */
function mergeChannelAndNumber(text: string, facts: Located[]): Located[] {
  const out: Located[] = [];
  for (const fact of facts) {
    const last = out[out.length - 1];
    const between = last ? text.slice(last.end, fact.at) : "";
    if (
      last?.kind === "contact" &&
      fact.kind === "contact" &&
      /^[\s:]*(on|at|via)?[\s:]*$/i.test(between)
    ) {
      out[out.length - 1] = {
        ...last,
        text: text.slice(last.at, fact.end).trim(),
        needs: [...last.needs, ...fact.needs],
        end: fact.end,
      };
      continue;
    }
    out.push(fact);
  }
  return out;
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

/** Whether `copy` states `fact`: the brief's own words for it, or every
 *  part of it in any spelling ("₦4,500" or "N4500", "7am" or "07:00"). */
export function factStated(fact: BriefFact, copy: string): boolean {
  if (saysVerbatim(fact.text, copy)) return true;
  const lower = copy.toLowerCase();
  const numbers = numbersIn(copy);
  const times = timesIn(copy);
  const days = new Set(calendarNames(copy));
  const phoneDigits = digits(copy);
  const stems = contentStems(copy);
  return fact.needs.every((need) => {
    if (need.startsWith("=")) return numbers.has(need.slice(1));
    if (need.startsWith("@")) return times.has(need.slice(1));
    if (need.startsWith("~")) return days.has(need.slice(1));
    if (need.startsWith("#")) return phoneDigits.includes(need.slice(1));
    if (need.startsWith("^")) return stems.has(need.slice(1));
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

export interface FactCoverage {
  /** Every hard fact the brief states. */
  facts: string[];
  /** Per direction, the facts it states after coverage. */
  stated: string[][];
  /** Facts drawn into a direction's footer because it left them out. */
  added: { direction: number; line: string }[];
  /** Facts a direction still does not state, and why. */
  leftOff: { direction: number; fact: string; reason: string }[];
}

/**
 * Draws every brief fact a direction left out into its footer, so whichever
 * design the client picks can be acted on. A fact joins an existing footer
 * line with a middle dot when it fits there (the last first), so a count is
 * never stranded on a line of its own and three full-looking lines still
 * take a short address; otherwise it starts a new line while there is room.
 * A fact that does not fit anywhere, or is longer than a line, is left off
 * and recorded with that reason.
 */
export function coverBriefFacts<T extends FactCopy>(
  directions: T[],
  briefText: string,
  options: BriefFactOptions = {},
): { directions: T[]; coverage: FactCoverage } {
  const facts = briefFacts(briefText, options);
  const coverage: FactCoverage = {
    facts: facts.map((f) => f.text),
    stated: [],
    added: [],
    leftOff: [],
  };
  const limit = COPY_LIMITS.footerLine;
  const covered = directions.map((direction, index) => {
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
      let at = -1;
      for (let j = lines.length - 1; j >= 0 && item.length <= limit; j -= 1) {
        if (`${lines[j]} · ${item}`.length <= limit) {
          at = j;
          break;
        }
      }
      if (at >= 0) {
        lines[at] = `${lines[at]} · ${item}`;
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
    return {
      ...direction,
      footerLines: lines,
      footerStyle:
        direction.footerStyle === "none" ? "text" : direction.footerStyle,
    };
  });
  return { directions: covered, coverage };
}

/** Place names `text` puts something in or at ("Lekki, Lagos"). */
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
 * Where a KO scene should be set: a place the brief names, else the one the
 * brand profile does. Null when neither names one; the scene is then left to
 * the art director.
 */
export function brandSetting(
  briefText: string | null | undefined,
  profile: (string | null | undefined)[],
): string | null {
  const fromBrief = placesIn(briefText)[0];
  const fromProfile = profile.map(placesIn).find((p) => p.length > 0)?.[0];
  if (fromBrief && fromProfile && !fromProfile.includes(fromBrief)) {
    return `${fromBrief}, ${fromProfile}`;
  }
  return fromProfile ?? fromBrief ?? null;
}
