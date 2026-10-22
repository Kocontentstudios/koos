import { contentStems } from "./text-overlap";

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

export const NUMBER_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
  thousand: 1000,
  million: 1000000,
  dozen: 12,
};

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "weekend",
  "weekends",
  "weekday",
  "weekdays",
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
const CALENDAR = new RegExp(`\\b(${[...DAYS, ...MONTHS].join("|")})\\b`, "gi");

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
  /(?<![\p{L}'])(Mon|Tues?|Wed|Thu(?:rs?)?|Fri|Sat|Sun)(?![\p{L}'])/gu;

/* A day relative to when the post goes out is as much a promise as a
   weekday: "Tonight only" on a post seen on Thursday morning is a lie. */
const RELATIVE_DAYS =
  /\b(today|tonight|tomorrow|tmrw|yesterday|this week|next week|this month|next month)\b/gi;

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
const CLAIMS: { stem: string; pattern: RegExp; also?: RegExp }[] = [
  {
    stem: "free",
    pattern: /\bfree\b/i,
    also: /\b(zero|no)\s+(\w+\s+)?(fees?|charges?|cost)\b|\bcomplimentary\b/i,
  },
  { stem: "deliver", pattern: /\bdeliver(y|ies|ed|s)?\b/i },
  { stem: "award", pattern: /\baward(s|ed)?\b/i },
  { stem: "bestsell", pattern: /\bbest[- ]?sell(er|ers|ing)?\b/i },
  { stem: "organic", pattern: /\borganic\b/i },
  { stem: "guarante", pattern: /\bguarantee(d|s)?\b/i },
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
    pattern: /\bhand-?made\b/i,
    also: /\bhand-?(woven|crafted|stitched|built|painted|poured)\b|\bby hand\b/i,
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
    pattern: /\b(daily|every ?day)\b/i,
    also: /\bevery ?day\b/i,
  },
];

/* A price or a time keeps the word in front of it. "from ₦4,500" makes a
   one-price slice a range, "before 7am" turns "pickup from 7am" into a
   promise about freshness: the number is the brief's, the claim is not. */
const QUALIFIER =
  /\b(before|after|until|till|by|from|under|over|starting(?: at| from)?|only|just|around|up to|as low as)\s*$/i;

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
  /** "qualifier|value" for every price or time the sources qualify
   *  ("from|7", "only|4500"). */
  qualified: Set<string>;
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
}

const NUMERIC =
  /([₦$£€]\s?|\bN(?=\d))?(\d[\d,]*(?:\.\d+)?)(\s?k\b)?(\s?%|\s?(?:am|pm)\b|:\d{2})?/gi;
const WORD_NUMBER = new RegExp(
  `\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b`,
  "gi",
);
const CURRENCY_AFTER = /^\s*(naira|ngn|usd|kobo|dollars?|pounds?|euros?)\b/i;

/* What a count counts: the next content words in the same phrase. "Made
   for two. Order by 12 Feb" counts nothing; "Two hearts" counts hearts. */
function followingStems(text: string, from: number, count = 3): string[] {
  const phrase = text.slice(from, from + 60).split(/[.,;:!?—–()]/)[0];
  return [...contentStems(phrase)].slice(0, count);
}

function nearCalendar(text: string, start: number, end: number): boolean {
  const around = text.slice(Math.max(0, start - 12), end + 12).toLowerCase();
  for (const match of around.matchAll(CALENDAR)) {
    if (MONTH_NAMES.has(match[1].toLowerCase())) return true;
  }
  return false;
}

function numberMentions(text: string): NumberMention[] {
  const mentions: NumberMention[] = [];
  for (const match of text.matchAll(NUMERIC)) {
    const [raw, currency, digits, thousands, suffix] = match;
    const start = match.index ?? 0;
    let value = Number.parseFloat(digits.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    if (thousands) value *= 1000;
    const end = start + raw.length;
    const money =
      Boolean(currency) ||
      CURRENCY_AFTER.test(text.slice(end)) ||
      suffix?.trim() === "%";
    const priceOrTime =
      money || /am|pm|:/i.test(suffix ?? "") || Boolean(currency);
    mentions.push({
      value,
      raw: raw.trim(),
      qualifier: priceOrTime ? qualifierBefore(text, start) : null,
      rangeStart: /^\s*(?:[-–—]|to)\s*[₦$£€N]?\d/i.test(text.slice(end)),
      rangeEnd: /(?:[-–—]|\bto)\s*$/i.test(
        text.slice(Math.max(0, start - 4), start),
      ),
      money,
      bare: money || Boolean(suffix) || nearCalendar(text, start, end),
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
  for (const match of text.matchAll(WORD_NUMBER)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    mentions.push({
      value: NUMBER_WORDS[match[1].toLowerCase()],
      raw: match[0],
      qualifier: null,
      bare: nearCalendar(text, start, end),
      money: false,
      context: followingStems(text, end),
    });
  }
  return mentions;
}

export function calendarNames(text: string): string[] {
  const names = [...text.matchAll(CALENDAR)].map((m) => {
    const name = m[1].toLowerCase();
    return DAY_NAMES.has(name) ? name.replace(/s$/, "") : name.slice(0, 3);
  });
  for (const match of text.matchAll(ABBREVIATED_DAY)) {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 4), match.index);
    if (/\bthe\s+$/i.test(before)) continue;
    names.push(DAY_ABBREVIATIONS[match[1]]);
  }
  for (const match of text.matchAll(RELATIVE_DAYS)) {
    names.push(match[1].toLowerCase().replace("tmrw", "tomorrow"));
  }
  for (const [pattern, name] of HOLIDAYS) {
    if (pattern.test(text)) names.push(name);
  }
  if (MAY_MONTH.test(text)) names.push("may");
  return names;
}

export function factLedger(sources: (string | null | undefined)[]): FactLedger {
  const text = sources.filter(Boolean).join("\n");
  const numbers = new Map<number, Set<string>>();
  const money = new Set<number>();
  const qualified = new Set<string>();
  for (const mention of numberMentions(text)) {
    if (mention.money) money.add(mention.value);
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
    qualified,
  };
}

/**
 * The facts in `text` the ledger cannot vouch for, as the words that state
 * them. Empty when everything checks out.
 */
export function inventedFacts(text: string, ledger: FactLedger): string[] {
  const invented: string[] = [];
  for (const mention of numberMentions(text)) {
    const known = ledger.numbers.get(mention.value);
    if (!known) {
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
  for (const claim of CLAIMS) {
    const match = claim.pattern.exec(text);
    if (
      match &&
      !ledgerHasStem(ledger, claim.stem) &&
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
  "typograph\\w*|typefaces?|fonts?|type size|serif|sans(?:-serif)?|lower-?case|upper-?case|all caps|capitals|caps|bold|italics?|weight|lettering|handwritten|script|kerning|letter-?spacing|condensed|legible|legibility|readable";
const SPATIAL = new RegExp(
  `\\b(${[PLACE_AND_SIZE, LIGHT, COLOUR, TYPE].join("|")})\\b|\\d+\\s?%|\\b(white|negative|empty) space\\b|\\bnext to\\b|\\bup ?front\\b|\\bprominent(ly)?\\b|\\b(dark|light|pale|cream|white|black) ground\\b|\\broom to breathe\\b`,
  "gi",
);

/* "The deadline sits in the footer" says which piece of copy holds a fact,
   which reasonHolds checks against the spec; it is not geometry. These verbs
   are only allowed beside a named piece of copy. */
const MEMBERSHIP =
  /^(sits?|sitting|placed|positioned|anchor(s|ed|ing)?|alongside)$/i;

/**
 * The first spatial, size, lighting, colour or type claim in `reason`, or
 * null. Words the sources themselves use ("Landmark Centre", "engineers
 * across Africa") do not count.
 */
export function spatialClaim(reason: string, sources = ""): string | null {
  const names = referencedElements(reason).length > 0;
  for (const match of withoutQuotes(reason).matchAll(SPATIAL)) {
    const word = match[0].toLowerCase().trim();
    if (names && MEMBERSHIP.test(word)) continue;
    const used = new RegExp(`\\b${word.replace(/[^a-z0-9 ]/g, ".")}\\b`, "i");
    if (!used.test(sources)) return match[0];
  }
  return null;
}

/* An article, conjunction or determiner with nothing after it, a trailing
   comma or dash, or an ellipsis: the shape of a sentence that was cut rather
   than finished. Prepositions are left out because English ends sentences
   on them ("the pastry commuters queue for"). */
const DANGLING_END =
  /(\s(a|an|the|and|or|but|of|than|its|their|your|our|every|each|very|this|these|those|into|which|who))$|[,;:–—-]$|(…|\.\.\.)$/i;

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
  {
    name: "date",
    mention: new RegExp(
      `\\b(the date|dates|the day|deadline|${[...DAYS, ...MONTHS].join("|")})\\b`,
      "i",
    ),
    present: new RegExp(
      `\\b(${[...DAYS, ...MONTHS].join("|")}|today|tomorrow|tonight)\\b`,
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
  const aboutImage = IMAGE_WORDS.test(reason);
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

function compact(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function wordInBrief(word: string, brief: Set<string>, flat: string) {
  const stems = [...contentStems(word)];
  if (stems.length === 0) return false;
  return stems.every((s) => brief.has(s)) || flat.includes(compact(word));
}

/** Whether every content stem of the product name appears in the brief, so
 *  the product the plate is checked against is the user's, not the model's.
 *  Spelling apart ("millefeuille" for "mille-feuille") still counts. */
export function productFromBrief(name: string, briefText: string): string {
  const words = name.match(/[\p{L}\p{N}'-]+/gu) ?? [];
  if (words.every((w) => contentStems(w).size === 0)) return "";
  const brief = contentStems(briefText);
  const flat = compact(briefText);
  return words.every(
    (w) => contentStems(w).size === 0 || wordInBrief(w, brief, flat),
  )
    ? name.trim()
    : "";
}

/** The brief's own words for the part of `name` it states: "mille-feuille"
 *  for "mille-feuille slice", "strawberry mille-feuille" for "Strawberry
 *  Mille-feuille Napoleon". Empty when no word of it is in the brief. */
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
      flatWanted.some((w) => w === word || w.includes(word) || word.includes(w))
    );
  });
  if (hits.length === 0) return "";
  const first = hits[0];
  /* The run of hits that starts at the first: a product is named in one
     place, and a word the name shares with a later sentence is not it. */
  let last = first;
  for (const hit of hits.slice(1)) {
    const gap = briefText.slice(
      (last.index ?? 0) + last[0].length,
      hit.index ?? 0,
    );
    if (!/^[\s-]*$/.test(gap)) break;
    last = hit;
  }
  return briefText
    .slice(first.index ?? 0, (last.index ?? 0) + last[0].length)
    .trim();
}

/**
 * The product each direction's plate is checked for: the model's name when
 * the brief states it, else the sibling's, else the brief's own words for
 * the part of the name it does state. The brief's product, whatever the
 * model called it (round-2 critic: "Strawberry Napoleon" skipped the check).
 */
export function resolveBriefProducts(
  names: readonly string[],
  briefText: string,
): { name: string; from: "model" | "sibling" | "brief" | "none" }[] {
  const strict = names.map((n) => productFromBrief(n, briefText));
  const anyStrict = strict.find(Boolean) ?? "";
  const spans = names.map((n) => briefSpanFor(n, briefText));
  const anySpan = spans.reduce((a, b) => (b.length > a.length ? b : a), "");
  return names.map((_, i) => {
    if (strict[i]) return { name: strict[i], from: "model" };
    if (anyStrict) return { name: anyStrict, from: "sibling" };
    if (spans[i]) return { name: spans[i], from: "brief" };
    if (anySpan) return { name: anySpan, from: "brief" };
    return { name: "", from: "none" };
  });
}
