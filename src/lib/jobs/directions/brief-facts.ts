import { MAX_FOOTER_LINES } from "@/lib/design/render/footer";
import { calendarNames, NUMBER_WORDS } from "./claims";
import { COPY_LIMITS } from "./schema";

/**
 * The hard facts a brief states, and whether a design states them.
 *
 * inventedFacts stops copy saying what the brief does not; this is the other
 * direction. The round-2 workshop brief gave a day, a time, ages, a place and
 * a WhatsApp number, and both delivered designs dropped four of them: an
 * event post a parent cannot act on. Every fact found here must be drawn on
 * a direction, or the job records why it was left off.
 */

export type BriefFactKind =
  | "day"
  | "time"
  | "price"
  | "age"
  | "place"
  | "contact"
  | "quantity";

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

const TIME =
  /\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b|\b(noon|midday|midnight)\b/gi;

/** Minutes past midnight for every clock time in `text`. */
function timesIn(text: string): Set<string> {
  const times = new Set<string>();
  for (const m of text.matchAll(TIME)) {
    if (m[4]) {
      times.add(m[4].toLowerCase() === "midnight" ? "0" : "720");
      continue;
    }
    const hour = (Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0);
    times.add(String(hour * 60 + Number(m[2] ?? 0)));
  }
  return times;
}

const PRICE =
  /(?:₦|\bNGN\s?|\bN(?=\d)|\$|£|€)\s?\d[\d,]*(?:\.\d+)?k?\b|\b\d[\d,]*(?:\.\d+)?k?\s?(?:naira|ngn)\b/gi;
const TIME_SPAN =
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)(?:\s?(?:[-–—]|to|until)\s?\d{1,2}(?::\d{2})?\s?(?:am|pm))?\b|\b(?:before|after|by|until)?\s?(?:noon|midday)\b/gi;
const AGE =
  /\bages?\s*\d{1,2}\s*(?:[-–—]|to)\s*\d{1,2}\b|\bages?\s*\d{1,2}\s*\+|\b\d{1,2}\s*(?:[-–—]|to)\s*\d{1,2}\s*(?:years?|yrs?)(?:[- ]olds?)?\b|\b(?:under|over)[- ]\d{1,2}s?\b/gi;
const PHONE = /(?:\+?\d[\d\s-]{8,}\d)/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g;
const URL =
  /\b(?:https?:\/\/)?(?:[\w-]+\.)+(?:com|ng|co|org|io|net|shop|store|africa)(?:\/[\w/-]*)?\b/gi;
const HANDLE = /(?<![\w.])@[\w.]{2,}\b/g;
const CHANNEL = /\b(whatsapp|instagram dm|dm us|text us|call us)\b/gi;
const PLACE =
  /\b(?:in|at|from|around|across|near)\s+(?:(?:our|the)\s+)?((?:[A-Z][\p{L}'’-]+)(?:,?\s+(?:[A-Z][\p{L}'’-]+))*)/gu;
const UNIT =
  "ml|cl|l|litres?|liters?|kg|g|grams?|pieces?|pcs|spots?|seats?|slots?|places?|tickets?|bottles?|boxes?|packs?|slices?|cups?|plates?|sessions?|classes?|weeks?|hours?|days?|nights?|people|guests?|kids?|children|throws?|cushions?|items?|flavours?|flavors?";
/* "Twelve new throws and cushions" is one count: drawing "Twelve new
   throws" alone changes what was counted (round-3 eval, textile). */
const QUANTITY = new RegExp(
  `\\b(\\d+|${Object.keys(NUMBER_WORDS).join("|")})\\s?(?:new\\s+)?(${UNIT})\\b(?:\\s+(?:and|&)\\s+(?:${UNIT})\\b)?`,
  "gi",
);

/* Proper words that open a place phrase but are not places. */
const NOT_PLACES =
  /^(whatsapp|instagram|facebook|tiktok|x|twitter|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|christmas|easter|eid)$/i;

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function digits(text: string): string {
  return text.replace(/\D/g, "");
}

/** The brief's hard facts, each once, in the order the brief gives them. */
export function briefFacts(briefText: string): BriefFact[] {
  const text = briefText ?? "";
  const facts: (BriefFact & { at: number })[] = [];
  const taken: [number, number][] = [];
  const claim = (start: number, end: number) => {
    if (taken.some(([s, e]) => start < e && end > s)) return false;
    taken.push([start, end]);
    return true;
  };
  const add = (
    kind: BriefFactKind,
    match: RegExpMatchArray,
    needs: string[],
    surface = match[0],
  ) => {
    const start = match.index ?? 0;
    if (needs.length === 0 || !claim(start, start + match[0].length)) return;
    facts.push({ kind, text: surface.trim(), needs, at: start });
  };

  for (const m of text.matchAll(PHONE)) {
    if (digits(m[0]).length >= 9) add("contact", m, [`#${digits(m[0])}`]);
  }
  for (const m of text.matchAll(EMAIL)) add("contact", m, [m[0].toLowerCase()]);
  for (const m of text.matchAll(URL)) {
    add("contact", m, [m[0].toLowerCase().replace(/^https?:\/\//, "")]);
  }
  for (const m of text.matchAll(HANDLE))
    add("contact", m, [m[0].toLowerCase()]);
  for (const m of text.matchAll(CHANNEL))
    add("contact", m, [m[1].toLowerCase()]);
  for (const m of text.matchAll(PRICE)) {
    add(
      "price",
      m,
      [...numbersIn(m[0])].map((n) => `=${n}`),
    );
  }
  for (const m of text.matchAll(AGE)) {
    add(
      "age",
      m,
      [...numbersIn(m[0])].map((n) => `=${n}`),
    );
  }
  for (const m of text.matchAll(TIME_SPAN)) {
    add(
      "time",
      m,
      [...timesIn(m[0])].map((t) => `@${t}`),
    );
  }
  for (const m of text.matchAll(QUANTITY)) {
    add(
      "quantity",
      m,
      [...numbersIn(m[1])].map((n) => `=${n}`),
    );
  }
  for (const name of new Set(calendarNames(text))) {
    const at = text.toLowerCase().indexOf(name.slice(0, 3));
    const surface = dayText(text, name) ?? capitalise(name);
    facts.push({
      kind: "day",
      text: surface,
      /* "3 November" is two facts' worth: the month and the day of it. */
      needs: [`~${name}`, ...[...numbersIn(surface)].map((n) => `=${n}`)],
      at: at < 0 ? text.length : at,
    });
  }
  for (const m of text.matchAll(PLACE)) {
    const words = m[1].split(/,?\s+/).filter((w) => !NOT_PLACES.test(w));
    if (words.length === 0) continue;
    const start = (m.index ?? 0) + m[0].indexOf(words[0]);
    if (!claim(start, start + words[0].length)) continue;
    facts.push({
      kind: "place",
      text: words.join(" "),
      needs: words.map((w) => w.toLowerCase()),
      at: start,
    });
  }
  facts.sort((a, b) => a.at - b.at);
  return mergeChannelAndNumber(text, facts).map(({ at: _at, ...fact }) => fact);
}

/* "WhatsApp 0803 555 0142" is one way to reach the client, not two facts
   to be drawn apart. */
function mergeChannelAndNumber<F extends BriefFact & { at: number }>(
  text: string,
  facts: F[],
): F[] {
  const out: F[] = [];
  for (const fact of facts) {
    const last = out[out.length - 1];
    const between = last ? text.slice(last.at + last.text.length, fact.at) : "";
    if (
      last?.kind === "contact" &&
      fact.kind === "contact" &&
      /^[\s:]*(on|at|via)?[\s:]*$/i.test(between)
    ) {
      out[out.length - 1] = {
        ...last,
        text: text.slice(last.at, fact.at + fact.text.length),
        needs: [...last.needs, ...fact.needs],
      };
      continue;
    }
    out.push(fact);
  }
  return out;
}

/* The day as the brief wrote it, keeping a date's number ("3 November")
   and a "this" or "every" in front of it. */
function dayText(text: string, name: string): string | null {
  const stem = /\s/.test(name) ? name : `${name.slice(0, 3)}\\p{L}*`;
  const date = new RegExp(
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${stem}|\\b${stem}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`,
    "iu",
  ).exec(text);
  if (date) return capitalise(date[0]);
  const word = new RegExp(`\\b(?:(?:this|next|every) )?${stem}`, "iu").exec(
    text,
  );
  return word ? capitalise(word[0]) : null;
}

/** Whether `copy` states `fact`. */
export function factStated(fact: BriefFact, copy: string): boolean {
  const lower = copy.toLowerCase();
  const numbers = numbersIn(copy);
  const times = timesIn(copy);
  const days = new Set(calendarNames(copy));
  const phoneDigits = digits(copy);
  return fact.needs.every((need) => {
    if (need.startsWith("=")) return numbers.has(need.slice(1));
    if (need.startsWith("@")) return times.has(need.slice(1));
    if (need.startsWith("~")) return days.has(need.slice(1));
    if (need.startsWith("#")) return phoneDigits.includes(need.slice(1));
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

function drawnText(copy: FactCopy): string {
  return [copy.headline, copy.subheadline, copy.cta, ...copy.footerLines]
    .filter(Boolean)
    .join(" \n ");
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

/** Footer lines holding `facts`, joined with middle dots, each within the
 *  footer line's limit. Null when one fact alone is too long for a line. */
function footerLinesOf(facts: BriefFact[]): string[] | null {
  const lines: string[] = [];
  let current = "";
  for (const fact of facts) {
    const item = capitalise(fact.text);
    if (item.length > COPY_LIMITS.footerLine) return null;
    const joined = current ? `${current} · ${item}` : item;
    if (joined.length <= COPY_LIMITS.footerLine) {
      current = joined;
    } else {
      lines.push(current);
      current = item;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Draws every brief fact a direction left out into its footer, so whichever
 * design the client picks can be acted on. A fact that does not fit (the
 * footer already holds three lines, or the fact is longer than a line) is
 * left off and recorded with that reason.
 */
export function coverBriefFacts<T extends FactCopy>(
  directions: T[],
  briefText: string,
): { directions: T[]; coverage: FactCoverage } {
  const facts = briefFacts(briefText);
  const coverage: FactCoverage = {
    facts: facts.map((f) => f.text),
    stated: [],
    added: [],
    leftOff: [],
  };
  const covered = directions.map((direction, index) => {
    const missing = facts.filter((f) => !factStated(f, drawnText(direction)));
    if (missing.length === 0) {
      coverage.stated.push(facts.map((f) => f.text));
      return direction;
    }
    const room = MAX_FOOTER_LINES - direction.footerLines.length;
    const fitted: BriefFact[] = [];
    for (const fact of missing) {
      const lines = footerLinesOf([...fitted, fact]);
      if (lines && lines.length <= room) {
        fitted.push(fact);
        continue;
      }
      coverage.leftOff.push({
        direction: index,
        fact: fact.text,
        reason:
          footerLinesOf([fact]) === null
            ? "longer than a footer line"
            : "the footer has no room left for it",
      });
    }
    coverage.stated.push(
      facts
        .filter((f) => !missing.includes(f) || fitted.includes(f))
        .map((f) => f.text),
    );
    const lines = footerLinesOf(fitted) ?? [];
    if (lines.length === 0) return direction;
    for (const line of lines) coverage.added.push({ direction: index, line });
    return {
      ...direction,
      footerLines: [...direction.footerLines, ...lines],
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
