import { findPhoneNumbersInText } from "libphonenumber-js/max";
import { NUMBER_WORDS, numberWordsOf } from "@/lib/design/copy-tokens";
import { contentStems, stem } from "./text-overlap";

/**
 * Whether what a direction says is true, decided in code.
 *
 * Round 1 delivered copy and "why this works" reasons that were false: a
 * headline promising "Seven minutes from your door", "12 Artisans" from a
 * brief about twelve throws, "the product fills two-thirds of the frame" on a
 * design where it filled 40%, "price and day together in the subheadline"
 * when they were not. Each failure has a checkable shape:
 *
 *  - an invented fact is a number, day, month or claim word the brief and
 *    brand never stated (inventedFacts);
 *  - a spatial claim is about position, size or light, which the model
 *    writes before any layout is measured (spatialClaim);
 *  - an element claim names a part of the design and a fact it carries,
 *    which the spec either holds or does not (reasonHolds).
 */

/* One table of number words for every reader of copy: the verifier's
   tokens and this file's counts agree on what "dozen" is. */
export { NUMBER_WORDS };

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "weekend",
  "weekday",
];
/* "May" is left out: it is also the verb, and "you may" is common copy. */
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "jan",
  "feb",
  "apr",
  "jun",
  "jul",
  "aug",
  "sept",
  "sep",
  "oct",
  "nov",
  "dec",
];
const MONTH_NAMES = new Set(MONTHS);
const DAY_NAMES = new Set(DAYS);
/* "Open Saturdays" names Saturday as much as "Open Saturday" does. */
const CALENDAR = new RegExp(
  `\\b(${DAYS.map((d) => `${d}s?`).join("|")}|${MONTHS.join("|")})\\b`,
  "gi",
);

/* "Sat & Sun", "Fri only": the round-2 code critic got both past the ledger.
   Only the capitalised forms count, and never after "the", so "under the
   Sun" and "sun-kissed" stay copy. */
const DAY_ABBREVIATIONS: Record<string, string> = {
  Mon: "monday",
  Tue: "tuesday",
  Tues: "tuesday",
  Wed: "wednesday",
  Thu: "thursday",
  Thur: "thursday",
  Thurs: "thursday",
  Fri: "friday",
  Sat: "saturday",
  Sun: "sunday",
};
const ABBREVIATED_DAY =
  /(?<![\p{L}'])(Mon|Tues?|Wed|Thu(?:rs?)?|Fri|Sat|Sun|MON|TUES?|WED|THU(?:RS?)?|FRI|SAT|SUN)(?![\p{L}'])/gu;
/* Lower-case "sat" and "sun" are words, so they count as days only beside
   another day ("sat & sun pickup", round-3 code critic). */
const ABBREVIATED_PAIR =
  /\b(mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)\s*(?:&|\/|-|–|,|and|to)\s*(mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)\b/gi;

/* A day relative to when the post goes out is as much a promise as a
   weekday: "Tonight only" on a post seen on Thursday morning is a lie. */
const RELATIVE_DAYS =
  /\b(today|tonight|tonite|2nite|tomorrow|tmrw|yesterday|this week|next week|all week|this month|next month|this (?:morning|afternoon|evening)|(?:the )?end of (?:the|this) month|month[- ]end|(?:this|the) (?:festive|holiday) season|this season)\b/gi;
const RELATIVE_NAMES: Record<string, string> = {
  tonite: "tonight",
  "2nite": "tonight",
  tmrw: "tomorrow",
  "this evening": "tonight",
  "this morning": "today",
  "this afternoon": "today",
  "all week": "this week",
  "month end": "this month",
  "month-end": "this month",
  "this season": "festive season",
};

/* Holidays are dates. "This Christmas" on a brief with no Christmas in it
   puts the offer on a day the client never chose. */
const HOLIDAYS: [RegExp, string][] = [
  [/\b(christmas|xmas)\b/i, "christmas"],
  [/\bvalentine'?s?\b/i, "valentine"],
  [/\beaster\b/i, "easter"],
  [/\beid\b/i, "eid"],
  [/\bramadan\b/i, "ramadan"],
  [/\bsallah\b/i, "sallah"],
  [/\bdiwali\b/i, "diwali"],
  [/\bnew year'?s?\b/i, "new year"],
  [/\bblack friday\b/i, "black friday"],
  [/\bcyber monday\b/i, "cyber monday"],
  [/\bmother'?s'? day\b/i, "mothers day"],
  [/\bfather'?s'? day\b/i, "fathers day"],
  [/\bindependence day\b/i, "independence day"],
  [/\bthanksgiving\b/i, "thanksgiving"],
  [/\bhalloween\b/i, "halloween"],
  [/\bboxing day\b/i, "boxing day"],
];

/* "May" the month, not "you may": only beside a preposition or a day. */
const MAY_MONTH =
  /\b(?:in|on|from|by|until|till|this|next|since|early|late|mid)[ -]May\b|\bMay \d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)? May\b/;

/* Claims a customer would act on that are never safe to assume: each is
   allowed only when its stem is in the brief or the brand profile. */
const CLAIMS: {
  stem: string;
  pattern: RegExp;
  also?: RegExp;
  /** How the product is made, where it comes from, what it is made of:
   *  licensed by the brief alone, never by the brand profile. A profile
   *  that calls the brand "handwoven" does not say this collection is woven
   *  by hand (round-6 eval: "woven by hand" for "woven by one artisan"). */
  briefOnly?: true;
}[] = [
  {
    stem: "free",
    pattern: /\bfree\b|\bcomplimentary\b|\bon the house\b/i,
    also: /\b(zero|no)\s+(\w+\s+)?(fees?|charges?|cost)\b|\bcomplimentary\b/i,
  },
  {
    stem: "deliver",
    /* "The headline delivers the greeting" is a metaphor, not a service. */
    pattern:
      /\bdeliver(y|ies|ed)\b|\b(we|will|to) deliver\b|\bdelivers? to\b|\bdoorstep\b|\bdispatch(ed)?\b|\bcourier\b/i,
  },
  {
    stem: "award",
    pattern: /\baward(s|ed)?\b|\b(prize|award)[- ]winning\b/i,
  },
  { stem: "bestsell", pattern: /\bbest[- ]?sell(er|ers|ing)?\b/i },
  { stem: "organic", pattern: /\borganic\b/i },
  {
    stem: "guarante",
    pattern:
      /\bguarantee(d|s)?\b|\bmoney[- ]back\b|\brefund(s|ed|able)?\b|\bpromised\b|\b(we|i) promise\b|\bwarrant(y|ied)\b/i,
  },
  { stem: "exclusive", pattern: /\bexclusive(ly)?\b/i },
  { stem: "limit", pattern: /\blimited\b/i },
  { stem: "certifi", pattern: /\bcertified\b/i },
  { stem: "vote", pattern: /\bvoted\b/i },
  { stem: "halal", pattern: /\bhalal\b/i },
  { stem: "vegan", pattern: /\bvegan\b/i },
  { stem: "gluten", pattern: /\bgluten\b/i },
  { stem: "homemade", pattern: /\bhome-?made\b/i },
  {
    stem: "handmade",
    pattern:
      /\bhand-?(made|crafted|woven|stitched|built|painted|poured|finished|dyed|picked|sewn)\b|\b(?:(made|crafted|woven|stitched|built|painted|poured|finished|dyed|picked|sewn)\s+)?by hand\b/i,
    briefOnly: true,
  },
  {
    stem: "sourced",
    pattern:
      /\b(locally|ethically|sustainably|responsibly) (sourced|made|grown)\b|\bimported\b|\beco-?friendly\b|\bsustainabl[ey]\b|\b100% (?:pure|natural)\b/i,
    briefOnly: true,
  },
  { stem: "nationwide", pattern: /\bnationwide\b/i },
  { stem: "same-day", pattern: /\bsame[- ]day\b/i },
  {
    stem: "number one",
    pattern: /\bnumber[- ]one\b|#\s?1\b|\bno\.\s?1\b/i,
  },
  { stem: "half", pattern: /\bhalf[- ](price|off)\b/i },
  {
    stem: "rated",
    pattern: /\b(top|highest|best|highly)[- ]rated\b|\b(five|5)[- ]star\b/i,
    also: /\b(five|5)[- ]star\b/i,
  },
  { stem: "ship", pattern: /\bship(s|ped|ping)?\b/i },
  /* "Saturday only", "Only a few left": a limit the client never set. */
  { stem: "only", pattern: /\bonly\b/i },
  {
    stem: "get one",
    pattern: /\bbuy one,? get one\b|\bbogo\b|\b(2|two) for (1|one)\b/i,
  },
  {
    stem: "popular",
    pattern:
      /\bby popular demand\b|\bmost popular\b|\b(fan|crowd)[- ]favou?rites?\b/i,
  },
  { stem: "sold out", pattern: /\bsold[- ]out\b|\bsell(s|ing)? out\b/i },
  { stem: "selling fast", pattern: /\bselling fast\b/i },
  { stem: "few left", pattern: /\bfew left\b/i },
  { stem: "last chance", pattern: /\blast chance\b/i },
  { stem: "while stock", pattern: /\bwhile (stocks?|supplies) last\b/i },
  {
    stem: "best",
    pattern: /\bbest\b(?![- ](enjoyed|served|wishes|regards))/i,
  },
  { stem: "fresh", pattern: /\bfresh(ly)?\b/i },
  {
    stem: "daily",
    pattern: /\b(daily|every ?day|every (morning|evening|night))\b/i,
    also: /\bevery ?day\b/i,
  },
  /* Offers the client never made (round-3 code critic). */
  { stem: "sale", pattern: /\bsales?\b/i },
  { stem: "discount", pattern: /\bdiscount(s|ed)?\b|\b\d+\s?% off\b/i },
  { stem: "promo", pattern: /\bpromo(tion(al)?)?\b/i },
  {
    stem: "inclusive",
    pattern: /\ball[- ]inclusive\b|\beverything (is )?included\b/i,
  },
  { stem: "deal", pattern: /\bdeals?\b/i },
  { stem: "offer", pattern: /\bspecial offer\b/i },
  /* Rankings: a superlative is a claim about every competitor. */
  {
    stem: "superlative",
    pattern:
      /\b(finest|tastiest|freshest|cheapest|lowest|biggest|largest|greatest|softest|richest|creamiest|flakiest|sweetest|juiciest|crispiest|smoothest|fastest|newest|tallest|unbeatable|unmatched|unrivall?ed|world[- ]class|legendary|iconic|famous|renowned|favou?rites?)\b|\bfirst (in|to)\b|\bthe original\b|\bmost (loved|popular|trusted)\b/i,
  },
  /* Counts with no number: "Loved by thousands", "Twice the layers". */
  {
    stem: "crowd",
    pattern:
      /\b(thousands|hundreds|dozens|millions|countless|loads of|tons of)\b/i,
  },
  {
    stem: "multiple",
    pattern: /\b(double|twice|triple[sd]?|treble|[23]x|(two|three) times)\b/i,
  },
  /* Availability and the senses: "gone by morning" on a pastry that is
     picked up from 7am, "Still warm" on a cold cream slice (round-3 live
     critic). */
  {
    stem: "gone",
    pattern:
      /\b(gone|won'?t last|going fast|go fast|runs? out|run out|before they'?re gone)\b/i,
  },
  {
    stem: "warm",
    pattern:
      /\b(warm|hot|steaming|oven[- ](fresh|warm|hot)|straight (from|out of) the oven)\b/i,
  },
];

/* A slot to fill, not copy: "[REGISTRATION LINK]" shipped on both
   conference directions (round-3 live critic). */
const PLACEHOLDER =
  /\[[^\]]*\]|\{[^}]*\}|<[^>]*>|\bX{3,}\b|\b(link|url|name|date|phone|number|address) here\b|\bTB[CDA]\b|\blorem ipsum\b/i;

/** The placeholder in `text`, or null. */
export function placeholderIn(text: string): string | null {
  return PLACEHOLDER.exec(text)?.[0] ?? null;
}

/* A price or a time keeps the word in front of it. "from ₦4,500" makes a
   one-price slice a range, "before 7am" turns "pickup from 7am" into a
   promise about freshness: the number is the brief's, the claim is not. */
const QUALIFIER =
  /\b(before|after|until|till|by|from|under|over|starting(?: at| from)?|only|just|around|up to|as low as|min\.?|minimum|max\.?|maximum|at least)\s*$/i;

/* "₦4,500+" and "₦4,500 and up" make one price a floor (round-3 code
   critic). */
const TRAILING_QUALIFIER =
  /^\s*(\+|and up\b|and above\b|and over\b|upwards\b|or more\b|onwards\b|minimum\b|min\b)/i;

function qualifierBefore(text: string, start: number): string | null {
  const match = QUALIFIER.exec(text.slice(Math.max(0, start - 24), start));
  return match ? match[1].toLowerCase() : null;
}

/* "Now in a bottle" says it was not bottled before. "Now open" and "now
   available" only restate a launch, which the brief has to be. */
const NOW_LAUNCH =
  /\bnow (available|open|here|live|serving|taking|booking|on)\b/i;
const BRIEF_LAUNCH = /\b(new|launch\w*|available|open\w*|introduc\w*)\b/i;

function nowClaim(text: string, ledgerText: string): string | null {
  const match = /\bnow\b(\s+\S+)?/i.exec(text);
  if (!match || /\bnow\b/i.test(ledgerText)) return null;
  if (NOW_LAUNCH.test(text) && BRIEF_LAUNCH.test(ledgerText)) return null;
  return match[0].trim();
}

export interface FactLedger {
  /** Every number the sources state, with the content stems around it, so
   *  "12 artisans" does not borrow the 12 of "twelve throws". */
  numbers: Map<number, Set<string>>;
  /** Numbers the sources state as a price or a percentage. The copy may
   *  restate those anywhere: in "₦4,500. Ready at 7am" the 4,500 is the
   *  price, not a count of something ready. A time is not one of them: the
   *  7 of "7am" does not license "seven minutes". */
  money: Set<number>;
  calendar: Set<string>;
  /** Every content stem of the sources, for claim words and spatial words
   *  the brief itself uses. */
  words: Set<string>;
  /** The sources lowercased, for phrase checks. */
  text: string;
  /** The brief and its title alone, lowercased: what licenses a claim
   *  about method, origin or material (CLAIMS briefOnly). */
  brief?: string;
  /** "qualifier|value" for every price or time the sources qualify
   *  ("from|7", "only|4500"). */
  qualified: Set<string>;
  /** "currency|value" for every price the sources state with a currency:
   *  "$4,500" is not the brief's "₦4,500". */
  currencies: Set<string>;
}

interface NumberMention {
  value: number;
  raw: string;
  /** The word in front of a price or a time ("from", "before"), if any. */
  qualifier: string | null;
  /** First or last value of a range ("10am–12pm"). */
  rangeStart?: boolean;
  rangeEnd?: boolean;
  /** Money, a clock time, a percentage or a calendar date: the number is the
   *  fact and the words around it are not a count of anything. */
  bare: boolean;
  money: boolean;
  /** Content stems of the next few words, what a count counts. */
  context: string[];
  /** The currency a price is stated in, normalised ("ngn", "usd"). */
  currency?: string | null;
  /** "one" before a noun: a count only of something the brief never
   *  names ("one loom"); "one box" for a brief's "a box" restates it. */
  one?: true;
}

const CURRENCIES: [RegExp, string][] = [
  [/^(₦|n|ngn|naira|kobo)$/i, "ngn"],
  [/^(\$|usd|dollars?)$/i, "usd"],
  [/^(£|gbp|pounds?)$/i, "gbp"],
  [/^(€|eur|euros?)$/i, "eur"],
];

function currencyOf(symbol: string | undefined): string | null {
  const said = (symbol ?? "").trim();
  if (!said) return null;
  return CURRENCIES.find(([pattern]) => pattern.test(said))?.[1] ?? null;
}

/* A number never ends on its comma: "UK 8 to 14, ₦115,000" read "14," and
   then "115" as what fourteen counted (round-7 live run, fashion). */
const NUMERIC =
  /([₦$£€]\s?|\bN(?=\d))?(\d(?:[\d,]*\d)?(?:\.\d+)?)(\s?k\b)?(\s?%|\s?(?:am|pm)\b|:\d{2})?/gi;
const CURRENCY_AFTER = /^\s*(naira|ngn|usd|kobo|dollars?|pounds?|euros?)\b/i;

/* What a count counts: the next content words in the same phrase. "Made
   for two. Order by 12 Feb" counts nothing; "Two hearts" counts hearts. */
/* Units of time are what a count counts ("Six days in Rome"), though the
   word comparison treats them as stopwords; read past them, "Six days" was
   taken for six of "Rome" and a correct rewrite refused (round-7 live
   critic, travel). */
const TIME_UNIT =
  /^(?:days?|nights?|weeks?|months?|years?|hours?|hrs?|mins?|minutes?)$/i;

function followingStems(text: string, from: number, count = 3): string[] {
  const phrase = text.slice(from, from + 60).split(/[.,;:!?—–()·|/]/)[0];
  const out: string[] = [];
  for (const word of phrase.match(/[\p{L}\p{N}'’-]+/gu) ?? []) {
    if (TIME_UNIT.test(word)) out.push(stem(word.toLowerCase()));
    else out.push(...contentStems(word));
    if (out.length >= count) break;
  }
  return [...new Set(out)].slice(0, count);
}

function nearCalendar(text: string, start: number, end: number): boolean {
  const around = text.slice(Math.max(0, start - 12), end + 12).toLowerCase();
  for (const match of around.matchAll(CALENDAR)) {
    if (MONTH_NAMES.has(match[1].toLowerCase())) return true;
  }
  return false;
}

/* "6.30pm" is the time "6:30pm", not the number 6.3. */
function withClockColons(text: string): string {
  return text.replace(/\b(\d{1,2})\.(\d{2})(\s?(?:am|pm))\b/gi, "$1:$2$3");
}

/* A phone number is a contact, not a count: "0812 444 7781 · 2pm" read
   7781 as a number of something (round-4 eval). Masked with spaces so
   every other position stays put. */
function withoutPhones(text: string): string {
  let masked = text;
  for (const found of findPhoneNumbersInText(text, "NG")) {
    /* libphonenumber takes the "9" of "08035550142, 9-5" into the number;
       the hours keep it (round-6 code critic, J3). */
    const surface = text.slice(found.startsAt, found.endsAt);
    const trimmed = surface.replace(/(?:[,;/]\s*|\s+)\d{1,2}$/, "");
    const end =
      trimmed.replace(/\D/g, "").length >= 10
        ? found.startsAt + trimmed.length
        : found.endsAt;
    masked =
      masked.slice(0, found.startsAt) +
      " ".repeat(end - found.startsAt) +
      masked.slice(end);
  }
  return masked;
}

/* "Ages 16+" and "16 and up" state an age, not a count of what follows. */
const AGE_BEFORE = /\bage[sd]?\s*$/i;
const FLOOR_AFTER = /^\s*(\+|and (up|over|above|older)\b)/i;

function numberMentions(rawText: string): NumberMention[] {
  const text = withoutPhones(withClockColons(rawText));
  const mentions: NumberMention[] = [];
  for (const match of text.matchAll(NUMERIC)) {
    const [raw, currency, digits, thousands, suffix] = match;
    const start = match.index ?? 0;
    let value = Number.parseFloat(digits.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    if (thousands) value *= 1000;
    const end = start + raw.length;
    const after = CURRENCY_AFTER.exec(text.slice(end));
    const money = Boolean(currency) || Boolean(after) || suffix?.trim() === "%";
    const priceOrTime =
      money || /am|pm|:/i.test(suffix ?? "") || Boolean(currency);
    const trailing = money ? TRAILING_QUALIFIER.exec(text.slice(end)) : null;
    mentions.push({
      value,
      raw: raw.trim(),
      currency: currencyOf(currency ?? after?.[1]),
      qualifier: priceOrTime
        ? (qualifierBefore(text, start) ??
          (trailing ? trailing[1].toLowerCase().replace(/\.$/, "") : null))
        : null,
      rangeStart: /^\s*(?:[-–—]|to)\s*[₦$£€N]?\d/i.test(text.slice(end)),
      rangeEnd: /(?:[-–—]|\bto)\s*$/i.test(
        text.slice(Math.max(0, start - 4), start),
      ),
      money,
      bare:
        money ||
        Boolean(suffix) ||
        nearCalendar(text, start, end) ||
        AGE_BEFORE.test(text.slice(Math.max(0, start - 6), start)) ||
        FLOOR_AFTER.test(text.slice(end)),
      context: followingStems(text, end),
    });
    if (suffix?.startsWith(":")) {
      const minutes = Number.parseInt(suffix.slice(1), 10);
      if (minutes > 0) {
        mentions.push({
          value: minutes,
          raw: raw.trim(),
          qualifier: null,
          bare: true,
          money: false,
          context: [],
        });
      }
    }
  }
  /* Number words are read as the verifier's tokenizer reads them, whole
     ("five hundred" is 500, "twenty-one" 21) and "one" only where it
     counts. */
  for (const said of numberWordsOf(text)) {
    const context = followingStems(text, said.end);
    if (/^one$/i.test(said.text)) {
      if (context.length === 0) continue;
      mentions.push({
        value: 1,
        raw: said.text,
        qualifier: null,
        bare: false,
        money: false,
        context,
        one: true,
      });
      continue;
    }
    mentions.push({
      value: said.value,
      raw: said.text,
      qualifier: null,
      bare: nearCalendar(text, said.start, said.end),
      money: false,
      context,
    });
  }
  return mentions;
}

/* Clock words are times as surely as "12pm" is. */
const CLOCK_WORDS = /\b(midnight|noon|midday)\b/gi;

function abbreviatedDay(word: string): string {
  const key = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  return DAY_ABBREVIATIONS[key];
}

export function calendarNames(text: string): string[] {
  const names = [...text.matchAll(CALENDAR)].map((m) => {
    const name = m[1].toLowerCase();
    const singular = name.replace(/s$/, "");
    return DAY_NAMES.has(singular) ? singular : name.slice(0, 3);
  });
  for (const match of text.matchAll(ABBREVIATED_DAY)) {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 4), match.index);
    if (/\bthe\s+$/i.test(before)) continue;
    names.push(abbreviatedDay(match[1]));
  }
  for (const match of text.matchAll(ABBREVIATED_PAIR)) {
    names.push(abbreviatedDay(match[1]), abbreviatedDay(match[2]));
  }
  for (const match of text.matchAll(RELATIVE_DAYS)) {
    const said = match[1].toLowerCase().replace(/^the /, "");
    names.push(
      RELATIVE_NAMES[said] ??
        (/end of/.test(said)
          ? "this month"
          : /season/.test(said)
            ? "festive season"
            : said),
    );
  }
  for (const [pattern, name] of HOLIDAYS) {
    if (pattern.test(text)) names.push(name);
  }
  if (MAY_MONTH.test(text)) names.push("may");
  return names;
}

export function factLedger(
  sources: (string | null | undefined)[],
  /** How many leading sources are the brief itself (the brief and its
   *  title); the rest are the brand profile and memory. */
  briefSources = sources.length,
): FactLedger {
  const text = sources.filter(Boolean).join("\n");
  const brief = sources.slice(0, briefSources).filter(Boolean).join("\n");
  const numbers = new Map<number, Set<string>>();
  const money = new Set<number>();
  const qualified = new Set<string>();
  const currencies = new Set<string>();
  for (const mention of numberMentions(text)) {
    if (mention.money) money.add(mention.value);
    if (mention.currency)
      currencies.add(`${mention.currency}|${mention.value}`);
    if (mention.qualifier)
      qualified.add(`${mention.qualifier}|${mention.value}`);
    /* "10am–12pm" licenses "from 10am" and "until 12pm". */
    if (mention.rangeStart) qualified.add(`from|${mention.value}`);
    if (mention.rangeEnd) {
      for (const word of ["until", "till", "to"]) {
        qualified.add(`${word}|${mention.value}`);
      }
    }
    const context = numbers.get(mention.value) ?? new Set<string>();
    for (const s of mention.context) context.add(s);
    numbers.set(mention.value, context);
  }
  return {
    numbers,
    money,
    calendar: new Set(calendarNames(text)),
    words: contentStems(text),
    text: text.toLowerCase(),
    brief: brief.toLowerCase(),
    qualified,
    currencies,
  };
}

function currencyHolds(mention: NumberMention, ledger: FactLedger): boolean {
  if (!mention.currency) return true;
  const stated = [...ledger.currencies].filter((c) =>
    c.endsWith(`|${mention.value}`),
  );
  return (
    stated.length === 0 ||
    ledger.currencies.has(`${mention.currency}|${mention.value}`)
  );
}

/**
 * The facts in `text` the ledger cannot vouch for, as the words that state
 * them. Empty when everything checks out.
 */
export function inventedFacts(text: string, ledger: FactLedger): string[] {
  const invented: string[] = [];
  for (const mention of numberMentions(text)) {
    if (mention.one && ledger.words.has(mention.context[0] ?? "")) continue;
    const known = ledger.numbers.get(mention.value);
    if (!known) {
      invented.push(mention.raw);
      continue;
    }
    if (!currencyHolds(mention, ledger)) {
      invented.push(mention.raw);
      continue;
    }
    if (
      mention.qualifier &&
      !ledger.qualified.has(`${mention.qualifier}|${mention.value}`)
    ) {
      invented.push(`${mention.qualifier} ${mention.raw}`);
      continue;
    }
    /* A count must count the same thing the brief counted: the first content
       word after it has to be one the brief put near that number. */
    const counted = mention.context[0];
    const isCount = !mention.bare && !ledger.money.has(mention.value);
    if (isCount && counted && !known.has(counted)) {
      const nearby = mention.context.some((s) => known.has(s));
      if (!nearby) invented.push(`${mention.raw} ${counted}`);
    }
  }
  for (const name of calendarNames(text)) {
    if (!ledger.calendar.has(name)) invented.push(name);
  }
  for (const match of text.matchAll(CLOCK_WORDS)) {
    const word = match[1].toLowerCase();
    const twelve =
      word === "midnight" ? /\b12\s?am\b/ : /\b12\s?pm\b|\bnoon\b|\bmidday\b/;
    if (!ledger.text.includes(word) && !twelve.test(ledger.text)) {
      invented.push(match[0]);
    }
  }
  for (const claim of CLAIMS) {
    const match = claim.pattern.exec(text);
    if (!match) continue;
    if (claim.briefOnly) {
      /* Variant by variant: "Locally made" does not license "Imported",
         nor "Hand-dyed" "Hand-woven" (round-6 code critic). */
      const said = new Set(
        [
          ...(ledger.brief ?? ledger.text).matchAll(everywhere(claim.pattern)),
        ].map((m) => claimVariant(m[0])),
      );
      for (const m of text.matchAll(everywhere(claim.pattern))) {
        if (!said.has(claimVariant(m[0]))) invented.push(m[0]);
      }
      continue;
    }
    if (
      !ledgerHasStem(ledger, claim.stem) &&
      !ledger.text.includes(match[0].toLowerCase()) &&
      !claim.also?.test(ledger.text)
    ) {
      invented.push(match[0]);
    }
  }
  const now = nowClaim(text, ledger.text);
  if (now) invented.push(now);
  return invented;
}

function ledgerHasStem(ledger: FactLedger, claimStem: string): boolean {
  const escaped = claimStem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${escaped}`).test(ledger.text)) return true;
  return [...ledger.words].some((w) => w.startsWith(claimStem));
}

/* Where things sit, how big they are, how light falls on them, and what
   colour or type they are set in. The model writes the reasons before a
   layout is measured, a palette resolved or an image painted, so none of
   this is something it can know. A colour the brief names ("rust and
   indigo") is exempt through the sources. */
const PLACE_AND_SIZE =
  "left|right|top|bottom|cent(?:re|er)(?:d|s)?|middle|corners?|half|halves|thirds?|two-thirds|quarters?|percent|fills?|filling|filled|dominat\\w*|large[rs]?|big(?:ger|gest)?|oversized|huge|small(?:er|est)?|tiny|full[- ]bleed|frames?|framed|framing|edges?|margins?|whitespace|beside|above|below|beneath|behind|atop|alongside|under(?:neath)?|upper|lower|anchor(?:s|ed|ing)?|across|columns?|panels?|bands?|stacked|against|backdrop|background|foreground|sits?|sitting|placed|positioned|close-?up|cropped|zoom\\w*|overlap\\w*|thumbnail";
/* The round-2 critic's "Soft morning light", "Moody lighting" and "Deep
   burgundy tones" all passed: light and open-ended colour are as unknowable
   before the render as position is. */
const LIGHT =
  "light|lights|lighting|lit|sunlit|sunlight|sunshine|daylight|backlit|shadows?|shadowed|moody|bright(?:er|est|ly|ness)?|dim|dimly|glows?|glowing|gleam\\w*|glossy|matte|golden hour|contrast\\w*";
const COLOUR =
  "tones?|hues?|colou?rs?|colou?red|palette|tint(?:s|ed)?|shades?|pastels?|neon|monochrom\\w*|red|green|blue|gold|golden|orange|yellow|pink|purple|navy|teal|amber|brown|grey|gray|burgundy|maroon|crimson|scarlet|beige|ivory|black|white|silver|bronze|copper|rust|indigo|violet|lilac|lavender|magenta|cyan|turquoise|emerald|olive|mint|coral|peach|salmon|charcoal|earthy|muted|saturated";
const TYPE =
  "typograph\\w*|typefaces?|type|fonts?|serif|sans(?:-serif)?|lower-?case|upper-?case|all caps|capitals|caps|bold|italics?|weight|lettering|letterforms?|letters|handwritten|script|kerning|(?:tight|loose|wide|generous|open) (?:leading|tracking)|line[- ]spacing|letter-?spacing|condensed|legible|legibility|readable";
/* Composition is as unknowable before the render as position: "Clean,
   uncluttered layout", "Generous spacing", "Symmetry", "Gradient wash"
   (round-3 code critic). */
const COMPOSITION =
  "layouts?|spacing|spaced|composition|composed|uncluttered|clutter(?:ed|ing|s)?|minimal(?:ist)?|symmetr\\w*|balanced|gradients?|textures?|textured|airy|breathes?|breathing|pops?|eyes?|gaze|glance|scan(?:s|ned|ning)?|reading order|hierarch\\w*|dominant|dominates?|treatment|first read|dominant read";
const SPATIAL = new RegExp(
  `\\b(${[PLACE_AND_SIZE, LIGHT, COLOUR, TYPE, COMPOSITION].join("|")})\\b|\\d+\\s?%|\\b(white|negative|empty) space\\b|\\bnext to\\b|\\bup ?front\\b|\\bprominent(ly)?\\b|\\b(dark|light|pale|cream|white|black) ground\\b|\\broom to breathe\\b`,
  "gi",
);

/* "The deadline sits in the footer" says which piece of copy holds a fact,
   which reasonHolds checks against the spec; it is not geometry. These verbs
   are only allowed beside a named piece of copy. */
const MEMBERSHIP =
  /^(sits?|sitting|placed|positioned|anchor(s|ed|ing)?|alongside)$/i;

/* The content words either side of each word, in order: "warm evening
   light" gives light the neighbour "evening". */
const GLUE = new Set(
  "a an the and or of in on at to for with our your its their is are be".split(
    " ",
  ),
);

function neighbours(text: string): Map<string, Set<string>> {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter(
    (w) => !GLUE.has(w),
  );
  const around = new Map<string, Set<string>>();
  words.forEach((word, i) => {
    const set = around.get(word) ?? new Set<string>();
    if (words[i - 1]) set.add(words[i - 1]);
    if (words[i + 1]) set.add(words[i + 1]);
    around.set(word, set);
  });
  return around;
}

/**
 * Whether the sources use `word` in the sense the reason does: beside the
 * same neighbour. "light refreshments" does not license "warm evening
 * light", nor "Bright minds" "Bright, high-contrast type"; "rust and indigo"
 * does license "Rust and indigo echo the collection".
 */
function usedInSameSense(
  word: string,
  reason: string,
  sources: string,
): boolean {
  const ours = neighbours(reason).get(word);
  const theirs = neighbours(sources).get(word);
  if (!theirs) return false;
  if (!ours || ours.size === 0) return true;
  return [...ours].some((n) => theirs.has(n));
}

/**
 * The first spatial, size, lighting, colour, type or composition claim in
 * `reason`, or null. A word the sources use in the same sense ("Landmark
 * Centre", "engineers across Africa", "rust and indigo") does not count.
 */
export function spatialClaim(reason: string, sources = ""): string | null {
  const names = referencedElements(reason).length > 0;
  const plain = withoutQuotes(reason);
  for (const match of plain.matchAll(SPATIAL)) {
    const word = match[0].toLowerCase().trim();
    if (names && MEMBERSHIP.test(word)) continue;
    if (/\s/.test(word)) {
      if (sources.toLowerCase().includes(word)) continue;
      return match[0];
    }
    if (!usedInSameSense(word, plain, sources)) return match[0];
  }
  return null;
}

/* An article, conjunction or determiner with nothing after it, a trailing
   comma or dash, or an ellipsis: the shape of a sentence that was cut rather
   than finished. Prepositions are left out because English ends sentences
   on them ("the pastry commuters queue for"). */
const DANGLING_END =
  /(\s(a|an|the|and|or|but|of|than|its|their|your|our|every|each|very|this|these|those|into|which|who))$|[,;:–—-]$|(…|\.\.\.)$/i;

function everywhere(pattern: RegExp): RegExp {
  return new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
}

/** One method or origin claim however it is spelled: "hand-woven",
 *  "handwoven" and "woven by hand" are one; "hand-dyed" is another. */
function claimVariant(match: string): string {
  const said = match.toLowerCase().replace(/\s+/g, " ").trim();
  const hand = /^hand-?\s?(\w+)$/.exec(said) ?? /^(\w+) by hand$/.exec(said);
  if (hand) return `hand:${hand[1]}`;
  return said.replace(/-/g, "");
}

export function looksCutOff(text: string): boolean {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return true;
  if (DANGLING_END.test(clean)) return true;
  const quotes = (clean.match(/["“”]/g) ?? []).length;
  const opens = (clean.match(/\(/g) ?? []).length;
  const closes = (clean.match(/\)/g) ?? []).length;
  return quotes % 2 === 1 || opens !== closes;
}

/** The copy a reason can point at. */
export interface DrawnCopy {
  headline: string;
  subheadline?: string;
  cta?: string;
  footerLines: string[];
}

/** What the image on the delivered design is known to show. */
export type ImageState =
  /** Not settled yet: the plate is painted after the reasons are written. */
  | "pending"
  /** The user's photograph, and the art director saw it. */
  | "seen"
  /** A plate the vision check confirmed shows the named product. */
  | "verified"
  /** An image nobody checked against the words: a photograph too large to
   *  show the art director, or a plate the check could not reach. */
  | "unverified"
  /** No image at all: a flat brand-colour design. */
  | "none";

export interface ReasonContext {
  copy: DrawnCopy;
  ledger: FactLedger;
  briefText: string;
  /** The brief's named product, when there is one. */
  product: string;
  image: ImageState;
  /** On KO imagery, the scene the plate was asked for. The check confirms
   *  the product, not the props, setting or light around it, so a reason
   *  describing those describes a picture nobody looked at. */
  paintedScene?: string;
  /** The parts the design draws beyond its copy ("logo", "quote-mark",
   *  "accent-rule", "image"), from the delivered document. Undefined before
   *  render, when only the parts no layout ever draws can be ruled out. */
  elements?: ReadonlySet<string>;
  /** What a look at the image found in it (plate check or the upload's
   *  subject check). A reason may say the image shows only what this holds. */
  imageDescription?: string;
  /** How many of the brief's hard facts the drawn copy leaves out, once
   *  drawn. Undefined before render. */
  factsMissing?: number;
}

/* Parts a reason can name besides the copy. "The accent tag calls out the
   8-spot limit" named a tag no layout draws; the button was meant. */
const PARTS: { part: string; pattern: RegExp }[] = [
  {
    part: "tag",
    pattern:
      /\b(tags?|badges?|stickers?|ribbons?|stamps?|labels?|pills?|chips?|seals?|roundels?)\b/i,
  },
  { part: "logo", pattern: /\b(logo|logos|wordmark|brand ?mark)\b/i },
  { part: "quote-mark", pattern: /\bquot(e|ation) marks?\b/i },
  {
    part: "accent-rule",
    pattern: /\b(accent (rule|line|bar)|rule|divider|underline)\b/i,
  },
];

/** Parts of a document a reason can be checked against. */
export function documentParts(elements: { type: string; id: string }[]) {
  const parts = new Set<string>();
  for (const element of elements) {
    if (element.type === "logo") parts.add("logo");
    if (element.type === "image") parts.add("image");
    if (element.id === "quote-mark") parts.add("quote-mark");
    if (element.id === "accent-rule") parts.add("accent-rule");
  }
  return parts;
}

/* The verbs of a claim about what a picture holds. */
const SHOWS =
  /\b(shows?|shown|showing|pictured|features?|featuring|captures?|depicts?|served with|paired with|alongside)\b/i;

/* A reason that opens on what is shown is about the picture. */
const SHOWS_LEAD =
  /^\s*(?:it\s+|this\s+)?(shows?|showing|pictures?|captures?|depicts?|features?)\b/i;

/* "Every fact a buyer needs is on the design": true only of a design that
   states every one. */
const EVERY_FACT =
  /\b(every|all (?:the|of the)?)\s*(?:key\s+|hard\s+|important\s+)?(facts?|details?|information|info)\b|\beverything (?:a |the |they |you |buyers? |customers? |parents? |guests? )?(?:\w+ )?needs?\b|\bno (?:fact|detail)s?\b[^.]*\b(missing|left out|dropped)\b|\bnothing\b[^.]*\b(missing|left out)\b/i;

/* Words a reason uses about any image, never a thing in it. */
const IMAGE_GENERIC = contentStems(
  "image images photo photograph picture shot visual imagery plate scene show shows shown showing pictured feature featuring capture depict real itself actual exactly clearly serve served pair paired",
);

const ELEMENTS: {
  key: keyof DrawnCopy;
  pattern: RegExp;
}[] = [
  {
    key: "subheadline",
    pattern:
      /\b(sub-?headline|subhead|supporting (line|copy)|sub-?line|second line|tagline|strapline)\b/gi,
  },
  { key: "headline", pattern: /\b(headline|heading)\b/gi },
  { key: "cta", pattern: /\b(button|cta|call[- ]to[- ]action)\b/gi },
  { key: "footerLines", pattern: /\b(footer|footnote)\b/gi },
];

const KINDS: { name: string; mention: RegExp; present: RegExp }[] = [
  {
    name: "price",
    mention: /\b(price[sd]?|pricing|cost|costs|fee|fees|naira)\b|[₦$£€]\s?\d/i,
    present: /[₦$£€]\s?\d|\d[\d,]*\s?(k\b|naira|ngn)|\bfree\b/i,
  },
  {
    name: "time",
    mention:
      /\b(the time|pickup time|opening time|start time|times|hours|\d{1,2}(:\d{2})?\s?(am|pm))\b/i,
    present: /\d{1,2}(:\d{2})?\s?(am|pm)\b|\b\d{1,2}:\d{2}\b/i,
  },
  /* "The button carries the WhatsApp number" on a button reading "Order on
     WhatsApp" (round-4 code critic). */
  {
    name: "phone number",
    mention:
      /\b(phone|(?:whatsapp|phone|contact|mobile|telephone) (?:number|line)|the number(?! of)|numbers? to call)\b/i,
    present: /(?:\d[\s().-]{0,2}){7,}/,
  },
  {
    name: "address",
    mention: /\b(address|location)\b/i,
    present:
      /\b\d{1,5}[A-Za-z]?,?\s+\p{Lu}[\p{L}'’.-]*|\b(road|rd|street|st|way|avenue|ave|close|crescent|drive|lane|plaza|mall|estate)\b/iu,
  },
  {
    name: "date",
    mention: new RegExp(
      `\\b(the date|dates|the day|deadline|${DAYS.map((d) => `${d}s?`).join("|")}|${MONTHS.join("|")})\\b`,
      "i",
    ),
    present: new RegExp(
      `\\b(${DAYS.map((d) => `${d}s?`).join("|")}|${MONTHS.join("|")}|today|tomorrow|tonight)\\b`,
      "i",
    ),
  },
];

/* Words a reason uses about the design itself that a scene prompt also
   happens to use; none of them describes a prop or a setting. */
const SCENE_SAFE = contentStems(
  "image photo photograph picture shot product brand colour color palette warm style mood feel design headline copy",
);

const IMAGE_WORDS =
  /\b(image|images|photo|photos|photograph|picture|pictures|shot|shots|visual|visuals|imagery|plate|scene)\b/i;

const ELEMENT_WORDS: Record<keyof DrawnCopy, string> = {
  headline: "headline",
  subheadline: "subheadline",
  cta: "button",
  footerLines: "footer",
};

function textOf(copy: DrawnCopy, key: keyof DrawnCopy): string {
  const value = copy[key];
  return Array.isArray(value) ? value.join(" ") : (value ?? "");
}

function referencedElements(reason: string): (keyof DrawnCopy)[] {
  let rest = reason;
  const found: (keyof DrawnCopy)[] = [];
  for (const { key, pattern } of ELEMENTS) {
    if (rest.match(pattern)) {
      found.push(key);
      rest = rest.replace(pattern, " ");
    }
  }
  return found;
}

function quotedPhrases(reason: string): string[] {
  return [...reason.matchAll(/["“]([^"”]{2,})["”]/g)].map((m) =>
    m[1].toLowerCase().trim(),
  );
}

/* Quoting the copy is not a claim about it: "The headline reads "Bold
   mornings"" says what is written, not that the type is bold. */
function withoutQuotes(reason: string): string {
  return reason.replace(/["“][^"”]{2,}["”]/g, " ");
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

/**
 * Whether `reason` is true of the design it will sit beside: no invented
 * fact, no spatial or lighting claim, every element it names carries what it
 * says it carries, and any claim about the image is one somebody checked.
 */
export function reasonHolds(
  reason: string,
  ctx: ReasonContext,
): { ok: true } | { ok: false; why: string } {
  const invented = inventedFacts(reason, ctx.ledger);
  if (invented.length > 0) {
    return { ok: false, why: `states ${invented.join(", ")}` };
  }
  const spatial = spatialClaim(reason, ctx.ledger.text);
  if (spatial) return { ok: false, why: `claims "${spatial}"` };

  if (EVERY_FACT.test(reason) && ctx.factsMissing !== 0) {
    return {
      ok: false,
      why:
        ctx.factsMissing === undefined
          ? "says every fact is on a design not yet drawn"
          : `says every fact is on the design, which leaves ${ctx.factsMissing} off`,
    };
  }

  const elements = referencedElements(reason);
  const pointedAt = elements.map((key) => textOf(ctx.copy, key)).join(" ");
  const allCopy = (["headline", "subheadline", "cta", "footerLines"] as const)
    .map((key) => textOf(ctx.copy, key))
    .join(" ");
  const where = elements.length > 0 ? pointedAt : allCopy;

  for (const element of elements) {
    if (!textOf(ctx.copy, element).trim()) {
      return { ok: false, why: `names a ${element} the design does not have` };
    }
  }
  const unquoted = withoutQuotes(reason);
  for (const { part, pattern } of PARTS) {
    if (!pattern.test(unquoted)) continue;
    const absent =
      part === "tag"
        ? !ctx.elements?.has("tag")
        : ctx.elements && !ctx.elements.has(part);
    if (absent) {
      return { ok: false, why: `names a ${part} the design does not have` };
    }
  }
  for (const kind of KINDS) {
    if (kind.mention.test(reason) && !kind.present.test(where)) {
      return { ok: false, why: `says the ${kind.name} is shown` };
    }
  }
  for (const mention of numberMentions(reason)) {
    if (!numberMentions(where).some((m) => m.value === mention.value)) {
      return { ok: false, why: `cites ${mention.raw}, which is not drawn` };
    }
  }
  for (const phrase of quotedPhrases(reason)) {
    if (!normalise(where).includes(phrase)) {
      return { ok: false, why: `quotes "${phrase}", which is not drawn` };
    }
  }
  /* "Leads with the croissant" names no piece of copy but says what the
     copy opens with, so the whole copy has to carry it (round-3 code
     critic: delivered on a mille-feuille brief). */
  const leadsWith = elements.length === 0 && LEADING_VERB.test(unquoted);
  if (elements.length > 0 || leadsWith) {
    const missing = objectNotIn(
      unquoted,
      elements.length > 0 ? pointedAt : allCopy,
      elements.length > 0,
    );
    if (missing) {
      return {
        ok: false,
        why:
          elements.length > 0
            ? `says the ${elements.map((e) => ELEMENT_WORDS[e]).join(" and ")} carries "${missing}"`
            : `says the copy carries "${missing}"`,
      };
    }
  }

  /* A reason that names a piece of copy is about that copy; only one that
     names none can be describing the picture. */
  if (ctx.paintedScene && elements.length === 0) {
    const said = contentStems(
      [ctx.ledger.text, ctx.product, allCopy].join(" "),
    );
    const scene = contentStems(ctx.paintedScene);
    const detail = [...contentStems(reason)].find(
      (s) => scene.has(s) && !said.has(s) && !SCENE_SAFE.has(s),
    );
    if (detail) {
      return {
        ok: false,
        why: `describes "${detail}" in a scene nobody checked`,
      };
    }
  }

  const productStems = [...contentStems(ctx.product)];
  const namesProduct =
    productStems.length > 0 &&
    productStems.every((s) => contentStems(reason).has(s));
  /* "Shows the cream between the layers" names no image word but can only
     be about the picture (round-4 code critic). */
  const aboutImage =
    IMAGE_WORDS.test(reason) ||
    (elements.length === 0 && SHOWS_LEAD.test(unquoted));
  if (aboutImage) {
    if (ctx.image === "none") return { ok: false, why: "describes an image" };
    if (ctx.image === "unverified") {
      return { ok: false, why: "describes an image nobody checked" };
    }
  }
  if (
    ctx.imageDescription !== undefined &&
    elements.length === 0 &&
    (aboutImage || SHOWS.test(unquoted))
  ) {
    const seen = contentStems(`${ctx.imageDescription} ${ctx.product}`);
    const named = contentStems(
      [ctx.ledger.text, ctx.paintedScene ?? "", allCopy].join(" "),
    );
    const missing = [...contentStems(reason)].find(
      (s) =>
        named.has(s) &&
        !seen.has(s) &&
        !SCENE_SAFE.has(s) &&
        !IMAGE_GENERIC.has(s),
    );
    if (missing) {
      return {
        ok: false,
        why: `says the image shows "${missing}", which it does not`,
      };
    }
  }
  if (namesProduct && elements.length > 0 && !aboutImage) {
    const drawn = contentStems(pointedAt);
    if (!productStems.every((s) => drawn.has(s))) {
      return { ok: false, why: `says the ${ctx.product} is in the copy` };
    }
  }
  return { ok: true };
}

/* What a reason says a piece of copy carries: "The footer gives [the
   WhatsApp number] so ordering is one tap". */
const COPY_VERB =
  /\b(speaks? to|talks? to|is for|aimed at|names?|naming|gives?|giving|states?|stating|shows?|showing|lists?|carries|carry|carrying|holds?|puts?|includes?|mentions?|spells? out|leads? with|opens? with|announces?|offers?|promises?|calls? out|highlights?|features?|adds?|says?|tells?|locks? in|pins? down|pins?|anchors?|keeps?|asks? for|invites?)\b/i;
const LEADING_VERB =
  /^\s*(leads? with|opens? with|names?|states?|gives?|spells? out|announces?|calls? out|puts?)\b/i;

/* "speaks to commuters" names who it is for, not what it says; only what
   follows "with" or "by naming" is carried. */
const AUDIENCE_VERB = /^(speaks? to|talks? to|is for|aimed at)$/i;
const OBJECT_END =
  /\s(?:so|so that|because|which|while|before|after|for|to|as|and then|making|letting|giving|without|instead)\b|[,;:.!?—–]/i;
/* Words a reason uses about what copy does, never a thing it carries. The
   price, time and date words are checked by KINDS. */
const NOT_CARRIED = contentStems(
  "straight away right clear clearly quick quickly first once upfront early simply plain plainly directly together whole exact exactly again key main core one tap nobody anyone everyone promise message idea detail details point info information thing things action step reason reasons benefit benefits value moment feeling mood headline subheadline button footer cta line lines copy text words word price prices pricing cost costs fee fees time times hour hours date dates day deadline brief product number numbers phone contact link event directly clearly appointment request requests asks crowd audience",
);

/* Verbs that say who the copy moves, not what it says. */
const NUDGE_VERB =
  /^(prompts?|invites?|urges?|asks?|tells?|encourages?|nudges?|helps?|lets?|gets?|makes?|reminds?|welcomes?|appeals?|reads?|feels?|works?|keeps?)$/i;
const CLAUSE_END =
  /\s(?:so|so that|because|which|while|without|instead)\b|[,;:.!?—–]/i;

/* What a reason that names a piece of copy says it holds: the clause after
   the verb that follows the name, whatever the verb ("The CTA points to the
   Ikoyi studio", "drives the Ikoyi fitting"). Null for a verb about who the
   copy moves; after "speaks to", only what follows "with". */
function objectAfterElement(reason: string): string | null {
  const element = ELEMENTS.map(({ pattern }) => {
    pattern.lastIndex = 0;
    return pattern.exec(reason);
  })
    .filter((m): m is RegExpExecArray => m !== null)
    .sort((a, b) => a.index - b.index)[0];
  for (const { pattern } of ELEMENTS) pattern.lastIndex = 0;
  if (!element) return null;
  const after = reason.slice(element.index + element[0].length);
  const verb = /^\s+([\p{L}'-]+)(\s+(?:to|in|out|for|with|down))?/u.exec(after);
  if (!verb) return null;
  const said = `${verb[1]}${verb[2] ?? ""}`.trim();
  let rest = after.slice(verb[0].length);
  if (AUDIENCE_VERB.test(said) || NUDGE_VERB.test(verb[1])) {
    const carried =
      /\bwith\b|\bby (?:naming|giving|stating|showing|putting)\b/i.exec(rest);
    if (!carried || NUDGE_VERB.test(verb[1])) return null;
    rest = rest.slice(carried.index + carried[0].length);
  }
  const end = CLAUSE_END.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}

function objectNotIn(
  reason: string,
  copy: string,
  namesElement: boolean,
): string | null {
  if (namesElement) {
    const object = objectAfterElement(reason);
    return object === null ? null : stemNotIn(object, copy);
  }
  const verb = COPY_VERB.exec(reason);
  if (!verb) return null;
  let rest = reason.slice((verb.index ?? 0) + verb[0].length);
  if (AUDIENCE_VERB.test(verb[0])) {
    const carried = /\bwith\b/i.exec(rest);
    if (!carried) return null;
    rest = rest.slice(carried.index + carried[0].length);
  }
  const end = OBJECT_END.exec(rest);
  return stemNotIn(end ? rest.slice(0, end.index) : rest, copy);
}

function stemNotIn(object: string, copy: string): string | null {
  const drawn = contentStems(copy);
  const flat = compact(copy);
  for (const s of contentStems(object)) {
    if (NOT_CARRIED.has(s) || /^\d+$/.test(s)) continue;
    if (calendarNames(s).length > 0) continue;
    if (!drawn.has(s) && !flat.includes(s)) return s;
  }
  return null;
}

function compact(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function wordInBrief(word: string, brief: Set<string>, flat: string) {
  const stems = [...contentStems(word)];
  if (stems.length === 0) return false;
  return stems.every((s) => brief.has(s)) || flat.includes(compact(word));
}

/* Single words that are in a brief but are never what it sells: a channel,
   a unit, a shop, a moment (round-3 code critic: "WhatsApp", "Lekki",
   "7am" and "shop" all resolved as products). */
const NOT_PRODUCTS = contentStems(
  "shop store bar studio brand business order orders ordering pickup delivery whatsapp instagram facebook tiktok call book booking customer customers commuter commuters people kids children price slice slices cup cups bottle bottles box boxes piece pieces week weekend morning evening launch offer month year panel talk event session workshop webinar sale app",
);
const CHANNELS = /^(whatsapp|instagram|facebook|tiktok|twitter|x|telegram)$/i;

function couldBeProduct(name: string, briefText: string): boolean {
  if (/\d/.test(name)) return false;
  const stems = [...contentStems(name)];
  if (stems.length === 0) return false;
  if (stems.every((s) => NOT_PRODUCTS.has(s))) return false;
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    if (CHANNELS.test(words[0])) return false;
    const escaped = words[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (
      new RegExp(
        `\\b(in|at|from|near|around|across|via|on)\\s+(our\\s+)?${escaped}\\b`,
        "i",
      ).test(briefText)
    ) {
      return false;
    }
  }
  return true;
}

/** Whether every content stem of the product name appears in the brief, so
 *  the product the plate is checked against is the user's, not the model's.
 *  Spelling apart ("millefeuille" for "mille-feuille") still counts. */
export function productFromBrief(name: string, briefText: string): string {
  const words = name.match(/[\p{L}\p{N}'-]+/gu) ?? [];
  if (words.every((w) => contentStems(w).size === 0)) return "";
  if (!couldBeProduct(name, briefText)) return "";
  const brief = contentStems(briefText);
  const flat = compact(briefText);
  return words.every(
    (w) => contentStems(w).size === 0 || wordInBrief(w, brief, flat),
  )
    ? name.trim()
    : "";
}

/* Words that open a product phrase without being part of it. */
const PRODUCT_LEADS =
  /^(new|our|the|a|an|latest|fresh|signature|seasonal|limited|special|this|these|my|brand-new|all-new|launch|launching|promote|promoting|introduce|introducing|announce|announcing|try|meet|showcase|order|sell|selling|presenting)$/i;

/**
 * The brief's whole name for a product, grown from one word of it to the
 * run of words around it in the same phrase: "strawberry" in "Launch our new
 * strawberry mille-feuille, ₦4,500" grows to "strawberry mille-feuille". A
 * plate checked for "a strawberry" passes a picture of a strawberry
 * (round-3 code critic).
 */
export function nounRunAround(
  briefText: string,
  start: number,
  end: number,
): string {
  const tokens = [...briefText.matchAll(/\p{L}[\p{L}'-]*|[^\p{L}\s]+/gu)];
  const at = tokens.findIndex((t) => (t.index ?? 0) >= start);
  const last = tokens.findIndex((t) => (t.index ?? 0) + t[0].length >= end);
  if (at < 0 || last < 0) return briefText.slice(start, end).trim();
  const isWord = (i: number) => {
    const word = tokens[i]?.[0];
    return (
      Boolean(word) &&
      /^\p{L}[\p{L}'-]*$/u.test(word) &&
      contentStems(word).size > 0 &&
      !PRODUCT_LEADS.test(word) &&
      !NOT_PRODUCTS.has([...contentStems(word)][0] ?? "")
    );
  };
  let first = at;
  while (first > 0 && isWord(first - 1)) first -= 1;
  let final = last;
  while (final < tokens.length - 1 && isWord(final + 1)) final += 1;
  const from = tokens[first].index ?? start;
  const to = (tokens[final].index ?? end) + tokens[final][0].length;
  return briefText.slice(from, to).trim();
}

/* "espresso flight" in "Our new single-origin espresso flight" is the
   single-origin espresso flight (round-4 eval: copy that dropped
   "single-origin" was counted as naming the product). */
function wholeName(name: string, briefText: string): string {
  if (!name) return name;
  const at = briefText.toLowerCase().indexOf(name.toLowerCase());
  if (at < 0) return name;
  const grown = nounRunAround(briefText, at, at + name.length);
  return grown.length > name.length &&
    grown.toLowerCase().includes(name.toLowerCase())
    ? grown
    : name;
}

/** The brief's own words for the part of `name` it states, grown to the
 *  whole phrase the brief names the product with. Empty when no word of it
 *  is in the brief. */
export function briefSpanFor(name: string, briefText: string): string {
  const tokens = [...briefText.matchAll(/[\p{L}\p{N}'-]+/gu)];
  const wanted = new Set(
    (name.match(/[\p{L}\p{N}'-]+/gu) ?? [])
      .filter((w) => contentStems(w).size > 0)
      .map(compact),
  );
  const flatWanted = [...wanted];
  const hits = tokens.filter((t) => {
    const word = compact(t[0]);
    return (
      contentStems(t[0]).size > 0 &&
      !NOT_PRODUCTS.has([...contentStems(t[0])][0] ?? "") &&
      flatWanted.some((w) => w === word || w.includes(word) || word.includes(w))
    );
  });
  if (hits.length === 0) return "";
  const first = hits[0];
  const span = nounRunAround(
    briefText,
    first.index ?? 0,
    (first.index ?? 0) + first[0].length,
  );
  return couldBeProduct(span, briefText) ? span : "";
}

/* "Launch our new strawberry mille-feuille", "Try our new flat white": a
   launch verb and "new". Without "new" the object is as often an event or a
   period ("Announce our panel", "Zero-fee launch month", round-4 eval). */
const PRODUCT_INTRO =
  /\b(?:launch(?:ing)?|promot(?:e|ing)|introduc(?:e|ing)|announc(?:e|ing)|try|meet|showcase|sell(?:ing)?|presenting)\s+(?:(?:our|the|a|an|my)\s+)?(?:(?:fresh|signature|seasonal|limited)\s+)*(?:new|latest|brand-new|all-new)\s+(?:(?:fresh|signature|seasonal|limited)\s+)*(\p{L}[\p{L}'-]*)/iu;

/** The product a brief introduces, in its own words, or "". */
export function briefProductPhrase(briefText: string): string {
  const match = PRODUCT_INTRO.exec(briefText);
  if (!match) return "";
  const word = match[1];
  const start = (match.index ?? 0) + match[0].length - word.length;
  const phrase = nounRunAround(briefText, start, start + word.length);
  return couldBeProduct(phrase, briefText) ? phrase : "";
}

/**
 * The product each direction's plate is checked for when the brief reader
 * (brief-read.ts) could not be reached: the model's name when the brief
 * states it, else the sibling's, else the product the brief introduces,
 * else the brief's own whole phrase for the part of the name it does state. The brief's product, whatever the model called it, and never
 * one modifier word of it.
 */
export function resolveBriefProducts(
  names: readonly string[],
  briefText: string,
): { name: string; from: "model" | "sibling" | "brief" | "none" }[] {
  const strict = names.map((n) =>
    wholeName(productFromBrief(n, briefText), briefText),
  );
  const anyStrict = strict.find(Boolean) ?? "";
  const spans = names.map((n) => briefSpanFor(n, briefText));
  const anySpan = spans.reduce((a, b) => (b.length > a.length ? b : a), "");
  const introduced = briefProductPhrase(briefText);
  /* The product the brief introduces beats a phrase grown from one word
     the model's name shares with it: "Iced coffee" on "Launch our new cold
     brew. Served over ice" grew to "ice" (round-4 code critic). */
  return names.map((_, i) => {
    if (strict[i]) return { name: strict[i], from: "model" };
    if (anyStrict) return { name: anyStrict, from: "sibling" };
    if (introduced) return { name: introduced, from: "brief" };
    if (spans[i]) return { name: spans[i], from: "brief" };
    if (anySpan) return { name: anySpan, from: "brief" };
    return { name: "", from: "none" };
  });
}
