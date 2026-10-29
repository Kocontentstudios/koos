import type { AspectRatio } from "@/lib/ai/image/types";
import type { BrandSummary } from "@/lib/ai/prompts/strategy";
import type { DesignElement } from "@/lib/design/document/schema";
import { type BriefFact, factsMissing } from "./brief-facts";
import type { ClaimChecker, ClaimCheckField } from "./claim-check";
import {
  type DrawnCopy,
  documentParts,
  type FactLedger,
  type ImageState,
  inventedFacts,
  looksCutOff,
  placeholderIn,
  productFromBrief,
  reasonHolds,
} from "./claims";
import { readsAsList } from "./footer-repeats";
import {
  COPY_LIMITS,
  DIRECTION_REASONS_MAX,
  DIRECTION_REASONS_MIN,
  type DirectionDraft,
  type DirectionSpec,
  DRAFT_LIMITS,
} from "./schema";
import { contentStems, soundsLikeFiller, usesJargon } from "./text-overlap";

/**
 * Brings a direction inside the contract, deterministically, after the model
 * has had its one chance to rewrite (brief.ts).
 *
 * Nothing here cuts a clause in half or adds an ellipsis. Text over its
 * limit keeps whole clauses when the clauses that fit still say something;
 * otherwise the field falls back to something true (the brief's own title
 * for a headline) or is left off (a subheadline, a button, a footer line, a
 * reason). Every reason shown is one reasonHolds accepts for the copy that is
 * actually drawn, topped up when needed with reasons built from that copy.
 */

/* Where a sentence can end with what came before it still whole: a full
   stop, a semicolon, a colon, a dash, or a comma that opens a new clause.
   A comma inside a list is not one of them: "names the product, price" is a
   list cut in half. */
const BREAKS =
  /[.!?;:](?=\s)|\s[-–—](?=\s)|,(?=\s+(so|which|because|while|where|since|as|before|after|when|then|with)\b)/gi;

function clean(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function trimEnd(text: string): string {
  return text.replace(/[\s,;:.–—-]+$/, "").trim();
}

/**
 * The longest run of whole clauses within `max`, or null when the clauses
 * that fit would not read as finished (a fragment shorter than a third of
 * the room, or one ending on "the").
 */
export function clampAtClause(text: string, max: number): string | null {
  const whole = clean(text);
  if (whole.length <= max) return whole;
  let best: string | null = null;
  for (const match of whole.matchAll(BREAKS)) {
    const end = match.index ?? 0;
    if (end > max) break;
    const kept = trimEnd(whole.slice(0, end));
    if (kept.length >= max / 3 && !looksCutOff(kept)) best = kept;
  }
  return best;
}

/** What makes a reason about THIS brief rather than any brief. */
export interface GroundingAnchors {
  /** Specific facts: the product's words, the brief's numbers and days, and
   *  the words for a price, a time or a date when the brief holds one. */
  hard: Set<string>;
  /** Every other content word of the brief and its title. */
  brief: Set<string>;
}

/* Words every rationale may use without saying anything about the brief.
   Left in, "uses the brand colours" would count as grounded for any brief
   that happens to say "brand". */
const DESIGN_VOCABULARY = new Set(
  [
    "brand",
    "design",
    "post",
    "colour",
    "color",
    "palette",
    "image",
    "photo",
    "photograph",
    "picture",
    "headline",
    "layout",
    "text",
    "copy",
    "logo",
    "font",
    "type",
    "typography",
    "visual",
    "message",
    "customer",
    "audience",
    "new",
    "launch",
    "available",
    "announce",
    "promote",
    "order",
  ].map((w) => [...contentStems(w)][0] ?? w),
);

const KIND_WORDS: { has: RegExp; words: string[] }[] = [
  {
    has: /[₦$£€]\s?\d|\d[\d,]*\s?(naira|ngn|usd|kobo)|\bfree\b|\bfees?\b|\bprice/i,
    words: ["price", "cost", "fee", "free", "offer", "saving"],
  },
  {
    has: /\d{1,2}(:\d{2})?\s?(am|pm)\b/i,
    words: ["time", "hour", "morning", "evening", "pickup", "early"],
  },
  {
    has: /\b(mon|tues|wednes|thurs|fri|satur|sun)day|weekend|weekday|january|february|march|april|may|june|july|august|september|october|november|december\b/i,
    words: ["date", "day", "deadline", "start", "week"],
  },
];

export function groundingAnchors({
  briefText,
  title,
  product,
  ledger,
  audience = "",
}: {
  briefText: string;
  title: string;
  product: string;
  ledger: FactLedger;
  /** The brand's audience. Its words count as specific only where the brief
   *  names them too ("commuters"): then a reason about them is about this
   *  brief, not about any post for the brand. */
  audience?: string | null;
}): GroundingAnchors {
  const hard = new Set<string>(contentStems(product));
  const briefStems = contentStems(`${briefText} ${title}`);
  for (const s of contentStems(audience)) {
    if (briefStems.has(s) && !DESIGN_VOCABULARY.has(s)) hard.add(s);
  }
  for (const value of ledger.numbers.keys()) hard.add(String(value));
  for (const name of ledger.calendar) {
    for (const s of contentStems(name)) hard.add(s);
  }
  const source = `${briefText} ${title}`;
  for (const kind of KIND_WORDS) {
    if (kind.has.test(source)) {
      for (const s of contentStems(kind.words.join(" "))) hard.add(s);
    }
  }
  const brief = new Set(
    [...contentStems(source)].filter((s) => !DESIGN_VOCABULARY.has(s)),
  );
  return { hard, brief };
}

/**
 * A reason is grounded when it names a specific fact of the brief (the
 * product, a number, a day, or the price, time or date as such), or two of
 * the brief's own words. One shared word is not enough: round 1 counted
 * "Warm tones feel inviting and friendly" as grounded because the brand's
 * tone said "warm".
 */
export function isGrounded(reason: string, anchors: GroundingAnchors): boolean {
  const stems = contentStems(reason);
  for (const value of reason.match(/\d[\d,]*/g) ?? []) {
    stems.add(value.replace(/,/g, ""));
  }
  let briefWords = 0;
  for (const s of stems) {
    if (anchors.hard.has(s)) return true;
    if (anchors.brief.has(s)) briefWords += 1;
  }
  return briefWords >= 2;
}

/** Everything the checks need, built once per job from the brief. */
export interface DirectionChecks {
  ledger: FactLedger;
  briefText: string;
  /** The brand's target audience, for grounding (groundingAnchors). */
  audience?: string | null;
  /** The brief's title, the headline of last resort: it is the user's own
   *  words, so it can never carry an invented fact. */
  title: string;
}

export interface ReasonSettings {
  copy: DrawnCopy;
  checks: DirectionChecks;
  product: string;
  image: ImageState;
  /** The scene the plate was asked for, on KO imagery (reasonHolds). */
  paintedScene?: string;
  /** What a look at the image found in it (reasonHolds). */
  imageDescription?: string;
  /** The delivered design, once drawn: reasons are then checked against its
   *  parts, and it can supply true reasons of its own (documentReasons). */
  drawn?: DrawnDesign;
  /** The brief's hard facts the drawn copy leaves out, once drawn: a reason
   *  that says every fact is there is true only at zero. */
  factsMissing?: number;
}

/** What documentReasons reads off a delivered design. */
export interface DrawnDesign {
  document: {
    width: number;
    height: number;
    elements: DesignElement[];
  };
  /** The subject rule's measurement, when the image has a known subject. */
  subject?: { ok: boolean } | null;
}

function holdsFor(settings: ReasonSettings, reason: string) {
  return reasonHolds(reason, {
    copy: settings.copy,
    ledger: settings.checks.ledger,
    briefText: settings.checks.briefText,
    product: settings.product,
    image: settings.image,
    paintedScene: settings.paintedScene,
    imageDescription: settings.imageDescription,
    factsMissing: settings.factsMissing,
    elements: settings.drawn
      ? documentParts(settings.drawn.document.elements)
      : undefined,
  });
}

function anchorsFor({ checks, product }: ReasonSettings): GroundingAnchors {
  return groundingAnchors({
    briefText: checks.briefText,
    title: checks.title,
    product,
    ledger: checks.ledger,
    audience: checks.audience,
  });
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const MONEY_IN = /([₦$£€]\s?|\bN(?=\d))\d[\d,]*(\.\d+)?k?|\d[\d,]*\s?naira/i;
const TIME_IN = /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i;
const DAY_IN =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekends?|weekdays?)\b/i;
const DATE_IN =
  /\b\d{1,2}(st|nd|rd|th)?\s+(january|february|march|april|june|july|august|september|october|november|december)\b|\b(january|february|march|april|june|july|august|september|october|november|december)\s+\d{1,2}\b/i;

/**
 * Reasons that are true by construction, read off the copy being drawn. Used
 * only to top a direction up to two when the model's own did not survive.
 */
export function factualReasons(settings: ReasonSettings): string[] {
  const { copy, product, image } = settings;
  const drawn = [copy.headline, copy.subheadline, copy.cta, ...copy.footerLines]
    .filter(Boolean)
    .join(" ");
  const candidates: string[] = [];
  const productStems = [...contentStems(product)];
  const headline = contentStems(copy.headline);
  if (productStems.length > 0 && productStems.every((s) => headline.has(s))) {
    candidates.push(`The headline names the ${product} straight away.`);
  }
  const money = MONEY_IN.exec(drawn)?.[0];
  if (money)
    candidates.push(
      `It gives the ${money.trim().replace(/[,.]+$/, "")} price, so nobody has to ask.`,
    );
  const time = TIME_IN.exec(drawn)?.[0];
  if (time)
    candidates.push(`It says ${time.trim()}, so people know when to come.`);
  const date = DATE_IN.exec(drawn)?.[0] ?? DAY_IN.exec(drawn)?.[0];
  if (date)
    candidates.push(
      `${capitalise(date.trim())} is written on the design itself.`,
    );
  if (productStems.length > 0 && (image === "verified" || image === "seen")) {
    candidates.push(`The image shows the ${product} itself.`);
  }
  if (copy.cta)
    candidates.push(`The button asks for one thing: "${copy.cta}".`);
  return candidates.filter(
    (reason) =>
      reason.length <= COPY_LIMITS.reason && holdsFor(settings, reason).ok,
  );
}

const CORNER_WORDS: Record<string, string> = {
  "top-left": "top left",
  "top-right": "top right",
  "bottom-left": "bottom left",
  "bottom-right": "bottom right",
};

function cornerOf(
  box: { x: number; y: number; width: number; height: number },
  doc: DrawnDesign["document"],
): string | null {
  const cx = (box.x + box.width / 2) / doc.width;
  const cy = (box.y + box.height / 2) / doc.height;
  const horizontal = cx < 0.34 ? "left" : cx > 0.66 ? "right" : null;
  const vertical = cy < 0.34 ? "top" : cy > 0.66 ? "bottom" : null;
  return horizontal && vertical
    ? CORNER_WORDS[`${vertical}-${horizontal}`]
    : null;
}

/**
 * Reasons read off the delivered document itself, each true by measurement:
 * the type sizes, the logo's corner, the subject rule. They may say where
 * things are because they are written after the layout, not before it.
 */
export function documentReasons(drawn: DrawnDesign): string[] {
  const { document: doc } = drawn;
  const reasons: string[] = [];
  const texts = doc.elements.filter(
    (e): e is Extract<DesignElement, { type: "text" }> =>
      e.type === "text" && !e.hidden,
  );
  const headline = texts.find((t) => t.role === "headline");
  if (
    headline &&
    texts.every((t) => t === headline || t.fontSize < headline.fontSize)
  ) {
    reasons.push("The headline is set larger than every other line.");
  }
  if (drawn.subject?.ok) {
    reasons.push("The product is drawn whole, with no copy laid over it.");
  }
  const logo = doc.elements.find((e) => e.type === "logo" && !e.hidden);
  const corner = logo ? cornerOf(logo, doc) : null;
  if (corner) reasons.push(`The brand's logo is in the ${corner} corner.`);
  return reasons;
}

/**
 * Reasons true of any copy, by construction: each quotes a field that is
 * drawn. The floor that keeps "why this works" at two whatever the model
 * wrote and whatever the checks refused.
 */
export function copyReasons(copy: DrawnCopy): string[] {
  const quote = (lead: string, text: string | undefined) => {
    const clean = (text ?? "").trim();
    if (!clean) return null;
    const whole = `${lead} "${clean}".`;
    if (whole.length <= COPY_LIMITS.reason) return whole;
    const words = clean.split(/\s+/);
    for (let n = words.length - 1; n >= 2; n -= 1) {
      const opening = `${lead.replace(/ reads$| says$| adds$/, " opens with")} "${words.slice(0, n).join(" ")}".`;
      if (opening.length <= COPY_LIMITS.reason) return opening;
    }
    return null;
  };
  const reasons = [
    quote("The headline reads", copy.headline),
    quote("The subheadline adds", copy.subheadline),
    quote("The button says", copy.cta),
    quote("The footer adds", copy.footerLines[0]),
  ].filter((r): r is string => r !== null);
  /* Two floors that claim nothing about size or order, so neither can be
     false of any copy (round-3 code critic: the old "Nothing competes with
     the headline" was itself an unmeasured hierarchy claim, and alone it
     left a one-word headline with a single reason). */
  for (const floor of COPY_FLOORS) {
    if (reasons.length >= DIRECTION_REASONS_MIN) break;
    reasons.push(floor);
  }
  return reasons;
}

const COPY_FLOORS = [
  "Every word on it comes from the brief or the brand profile.",
  "It carries one message, so there is one thing to take in.",
];

/** The copy a delivered document actually draws, by role. The footer is
 *  read from the document, not the spec: the builders drop a footer line
 *  that repeats the copy above it, and a reason about that line would
 *  describe nothing (round-3 live critic). */
export function drawnCopyOf(elements: readonly DesignElement[]): DrawnCopy {
  const texts = (role: string) =>
    elements
      .filter(
        (e): e is Extract<DesignElement, { type: "text" }> =>
          e.type === "text" &&
          !e.hidden &&
          e.role === role &&
          e.id !== "quote-mark",
      )
      .map((e) => e.text);
  const button = elements.find(
    (e): e is Extract<DesignElement, { type: "button" }> =>
      e.type === "button" && !e.hidden,
  );
  const subheadline = texts("subheadline")[0];
  return {
    headline: texts("headline").join(" "),
    ...(subheadline ? { subheadline } : {}),
    ...(button ? { cta: button.label } : {}),
    footerLines: texts("footer"),
  };
}

export interface SettledReason {
  text: string;
  /** Why a reason the model wrote was left off, for the log and the eval. */
  dropped?: string;
}

/**
 * The reasons to show: the model's own that are true of this design, best
 * first, topped up from factualReasons. Run when the direction is written
 * (image "pending") and again on the design actually delivered, because the
 * gate's correction can change the copy and the plate check decides what the
 * image shows.
 */
export function settleReasons(
  reasons: string[],
  settings: ReasonSettings,
): { reasons: string[]; dropped: { reason: string; why: string }[] } {
  const anchors = anchorsFor(settings);
  const dropped: { reason: string; why: string }[] = [];
  const seen = new Set<string>();
  const kept: { text: string; tier: number; order: number }[] = [];
  reasons.forEach((raw, order) => {
    const text = clampAtClause(raw, COPY_LIMITS.reason);
    if (!text) {
      dropped.push({ reason: raw, why: "too long to keep whole" });
      return;
    }
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    if (looksCutOff(text)) {
      dropped.push({ reason: raw, why: "reads as cut off" });
      return;
    }
    if (usesJargon(text)) {
      dropped.push({ reason: raw, why: "reads out the spec" });
      return;
    }
    const holds = holdsFor(settings, text);
    if (!holds.ok) {
      dropped.push({ reason: raw, why: holds.why });
      return;
    }
    if (kept.some((k) => saysTheSame(k.text, text))) {
      dropped.push({ reason: raw, why: "says what another reason says" });
      return;
    }
    const grounded = isGrounded(text, anchors);
    /* Best first: grounded and whole, grounded but shortened, plain, then
       praise that names nothing, kept only to reach two. */
    const shortened = text !== clean(raw);
    const tier =
      soundsLikeFiller(text) && !grounded
        ? 3
        : (grounded ? 0 : 2) + (shortened ? 1 : 0);
    kept.push({ text, tier, order });
  });

  const chosen: typeof kept = [];
  for (let tier = 0; tier <= 3; tier += 1) {
    if (tier > 0 && chosen.length >= DIRECTION_REASONS_MIN) break;
    chosen.push(...kept.filter((k) => k.tier === tier));
  }
  /* The model's own order within what is kept: it usually leads with the
     reason that matters most. */
  chosen.sort((a, b) => a.order - b.order);
  const out = chosen.map((k) => k.text);
  /* Topped up in order of how much each says about this brief. The copy
     quotes come last and cannot run out, so a direction always shows two
     (round-2 critic: every candidate before them could be refused). */
  /* A quote of the copy can still read as a claim the copy does not back
     ("The headline reads "Send money. Zero fees."" was scored as saying a
     price is shown, round-6 eval): quotes are held to the same rule, and
     the two floors that claim nothing come last. */
  const topUps = [
    ...factualReasons(settings),
    ...(settings.drawn ? documentReasons(settings.drawn) : []),
    ...copyReasons(settings.copy).filter(
      (reason) => COPY_FLOORS.includes(reason) || holdsFor(settings, reason).ok,
    ),
    ...COPY_FLOORS,
  ];
  /* A top-up that only repeats the price or time a kept reason already
     gives says nothing new (round-4 live run: two reasons, both the
     ₦4,500). */
  const factsIn = (text: string) =>
    [MONEY_IN, TIME_IN].flatMap((pattern) => {
      const found = pattern.exec(text)?.[0];
      return found ? [found.replace(/\s+/g, "").toLowerCase()] : [];
    });
  for (const extra of topUps) {
    if (out.length >= DIRECTION_REASONS_MIN) break;
    if (out.some((kept) => saysTheSame(kept, extra))) continue;
    const said = new Set(out.flatMap(factsIn));
    const repeats = factsIn(extra);
    if (repeats.length > 0 && repeats.every((f) => said.has(f))) continue;
    out.push(extra);
  }
  return { reasons: out.slice(0, DIRECTION_REASONS_MAX), dropped };
}

/* "Names the kaftan directly and plainly" and "names the kaftan straight
   away" are one reason shown twice (round-5 live run, fashion). */
function saysTheSame(a: string, b: string): boolean {
  const x = contentStems(a);
  const y = contentStems(b);
  const smaller = Math.min(x.size, y.size);
  if (smaller === 0) return a.toLowerCase() === b.toLowerCase();
  let shared = 0;
  for (const stem of x) if (y.has(stem)) shared += 1;
  return shared / smaller >= 0.7;
}

type CopyField = "headline" | "subheadline" | "cta";

/* A 24-hour time written as four digits: "0900", "2300". */
const HHMM = "(?:[01]\\d|2[0-3])[0-5]\\d";

/* The verbs a button starts with: what the customer does by tapping. */
const ACTION_VERB =
  /^(?:book|order|pre-?order|call|text|whatsapp|dm|message|chat|email|e-mail|contact|shop|buy|get|grab|reserve|join|register|sign|apply|send|submit|visit|come|walk|stop|try|claim|discover|explore|learn|start|enrol|enroll|save|see|view|watch|download|subscribe|follow|pick|collect|request|ask|find|meet|attend|taste|browse|read|rsvp|secure|donate|pay|upgrade|open|schedule|check|tap|click|enquire|inquire|talk|reach|hire|rent|treat|choose|pre-?book|plan|refer|share|vote|tell|take|bring|make|give|let|celebrate|enjoy|dine|eat|drink|sip)\b/i;

/* A verb followed by a schedule, an address or a noun naming a place is a
   label, not an action: "Open 7 days a week", "Open 24/7", "Shop 12,
   Admiralty Mall", "Book club Saturdays" (round-7 code critic). Any number
   after the verb was once a label, which refused "Call 0803 555 0142" and
   "Shop 3 new styles" (round-8 code critic, break 4). A duration that says
   when to act ("Shop 2 hrs before close") and "24/7" after any verb but
   "Open" ("Order 24/7") are when, not what (round-9 code critic). */
const WHEN = "(?!\\s+(?:before|after|ahead|early|prior)\\b)";
const NOT_AN_ACTION = new RegExp(
  [
    "^\\S+\\s+(?:club|clubs|mall|plaza)\\b",
    "^open\\s+24\\s*\\/\\s*7\\b",
    `^\\S+\\s+\\d+\\s*(?:,|$|days?\\b${WHEN}|hours?\\b${WHEN}|hrs?\\b${WHEN}|am\\b|pm\\b|[:.]\\d{2}\\b|\\s*[-–]\\s*\\d|\\s+to\\s+\\d)`,
    /* "0800 2300": a pair of 24-hour times is opening hours, not a
       phone (round-10 code critic). */
    `^\\S+\\s+${HHMM}\\s*(?:[-–]|to)?\\s*${HHMM}\\b`,
  ].join("|"),
  "iu",
);
/* "Shop 12 Admiralty Mall", "Shop 15 Lekki Phase 1": "Shop" is a place
   word as well as a verb, and a shop number followed by a capitalised name
   and then an address noun is an address. The noun must close the name,
   directly: read anywhere in the label, it made "Shop 2 Floor Lamps" and
   "Shop 10 Styles at the Mall" addresses and deleted the button (round-10
   code critic, break 5). Title Case alone never makes one ("Book 4
   Seats"). */
const ADDRESS_NOUN =
  /^(?:mall|plaza|market|road|rd|street|st|way|avenue|ave|close|crescent|lane|drive|estate|phase|complex|centre|center|house|tower|building|floor|block|arcade|square|wing)[,.]?$/i;

function isShopAddress(text: string): boolean {
  const rest = /^shop\s+\d+,?\s+(.+)$/i.exec(text)?.[1];
  if (!rest) return false;
  const words = rest.split(/\s+/);
  return words.some((noun, i) => {
    if (i === 0 || !ADDRESS_NOUN.test(noun)) return false;
    const named = words.slice(0, i).every((w) => /^\p{Lu}/u.test(w));
    const after = words.slice(i + 1);
    return (
      named &&
      (after.length === 0 || /[,.]$/.test(noun) || /^\d/.test(after[0]))
    );
  });
}

/* "Call 0803 555 0142", "WhatsApp 0803-555-0142 to book": the number is
   who to reach, and the button is the action of reaching them, whatever
   words follow. Read before the schedule test, which takes "0803-555" for
   an hour range. */
const CONTACT_ACTION =
  /^(?:call|text|whatsapp|dm|message|sms|ring|phone)\s+(?:(?:us\s+)?(?:on|at)\s+)?(\+?\d[\d\s().-]{5,}\d)(?:\s+\p{L}[\p{L}\s']*)?[.!]?$/iu;
/* "0900-1700" or "0800 2300" is opening hours written as a 24-hour range. */
const HOURS_RANGE = new RegExp(`^${HHMM}\\s*(?:[-–]|to)?\\s*${HHMM}$`, "i");

function isContactAction(text: string): boolean {
  const number = CONTACT_ACTION.exec(text)?.[1].trim();
  return (
    number !== undefined &&
    number.replace(/\D/g, "").length >= 7 &&
    !HOURS_RANGE.test(number)
  );
}

/** Whether a button label is an action: it starts with what the customer
 *  does ("Book a session"), not what they get ("First session free") or a
 *  place or a schedule. */
export function isAction(label: string): boolean {
  const text = label.trim().replace(/^[^\p{L}]+/u, "");
  if (!ACTION_VERB.test(text)) return false;
  if (isContactAction(text)) return true;
  return !NOT_AN_ACTION.test(text) && !isShopAddress(text);
}

/**
 * The brief's own call to action: its first sentence that is an action the
 * customer takes ("Call 0815 220 9031 to order.", "Ask for oat milk."), or
 * null. A design for such a brief carries a button, or says why not
 * (round-23 live run, storefront s1 shipped none).
 */
export function briefCallToAction(briefText: string): string | null {
  const sentences = briefText.match(/[^.!?]+[.!?]*/g) ?? [];
  return (
    sentences
      .map((sentence) => sentence.trim())
      .find(
        (sentence) =>
          sentence.length > 0 &&
          isAction(sentence) &&
          /* "Open daily 9am to 7pm" starts with a verb but is the hours. */
          !CLOCK_TIME.test(sentence),
      ) ?? null
  );
}

const CLOCK_TIME = /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i;

/** What became of a button a delivered design does not carry: the
 *  model's own, and why it could not be drawn, or that it wrote none. */
export function buttonLeftOff(
  report: Pick<FinalizeReport, "copyFallbacks"> | undefined,
  checks: Pick<DirectionChecks, "ledger">,
): { button: string | null; why: string } {
  const dropped = report?.copyFallbacks.find(
    (f) => f.field === "cta" && f.to === null,
  );
  if (!dropped) {
    return {
      button: null,
      why: "the model wrote none, and the button it was asked for could not be drawn",
    };
  }
  return {
    button: dropped.from,
    why: !isAction(dropped.from)
      ? `"${dropped.from}" is not an action the customer takes`
      : (copyFault(dropped.from, COPY_LIMITS.cta, checks.ledger) ??
        `"${dropped.from}" could not be drawn`),
  };
}

/** Why a piece of copy cannot go on the design as written, or null. */

export function copyFault(
  text: string,
  max: number,
  ledger: FactLedger,
): string | null {
  const whole = clean(text);
  if (whole.length > max) return `${whole.length} characters, limit ${max}`;
  /* The model's own cut-off copy ("Treat yourself to the", "Something
     sweet is coming…") goes back to it like any other fault. */
  if (looksCutOff(whole)) return "reads as an unfinished sentence";
  const placeholder = placeholderIn(whole);
  if (placeholder) return `holds the placeholder "${placeholder}"`;
  const invented = inventedFacts(whole, ledger);
  if (invented.length > 0) {
    return `states ${invented.join(", ")}, which the brief does not`;
  }
  return null;
}

/* Words of the languages KO's brands most often slip into, and the marks
   only they carry. The claim check reads language too; this holds when it
   cannot be reached (round-5 code critic: "Livraison gratuite à Lekki" was
   kept as a correction). */
const FOREIGN_WORD =
  /^(?:le|la|les|des|du|une|et|pour|avec|sur|chez|votre|nos|gratuit|gratuite|livraison|maintenant|nouveau|nouvelle|el|los|las|una|para|con|nuestro|nuestra|gratis|ahora|envío|nuevo|nueva|uma|grátis|agora|entrega|und|der|das|mit|für|jetzt)$/i;
const FOREIGN_MARK = /[àâäçèêëîïôöûùüÿñœæßãõ]/i;

/** Words of `text` in another language than the brief's, or none. */
export function foreignWords(text: string, sources: string): string[] {
  const known = new Set(
    (sources.toLowerCase().match(/[\p{L}']+/gu) ?? []).map((w) => w),
  );
  return (text.match(/[\p{L}']+/gu) ?? []).filter(
    (word) =>
      !known.has(word.toLowerCase()) &&
      (FOREIGN_WORD.test(word) || FOREIGN_MARK.test(word)),
  );
}

/** Whether `copy`'s headline, subheadline or button carries every word of
 *  the brief's name for what it promotes. */
export function copyNamesOffering(copy: DrawnCopy, offering: string): boolean {
  const wanted = contentStems(offering);
  const said = contentStems(
    [copy.headline, copy.subheadline, copy.cta].filter(Boolean).join(" "),
  );
  return [...wanted].every((stem) => said.has(stem));
}

/**
 * Whether a correction's copy may replace `before`'s: every field within its
 * limit, finished, stating only the brief's facts, in the brief's language,
 * still naming what the brief promotes when `before` did, and losing none of
 * the brief's hard facts `before` stated. The gate checks the pixels, not the
 * brief, so its judge may rewrite copy in a way that drops them (round-3
 * code critic: a kept correction emptied the footer of all four facts).
 */
export function correctionHolds(
  ledger: FactLedger,
  facts: readonly BriefFact[],
  {
    offering = "",
    sources = ledger.text,
  }: { offering?: string; sources?: string } = {},
): (before: DrawnCopy, after: DrawnCopy) => boolean {
  const missing = (copy: DrawnCopy) =>
    new Set(factsMissing(facts, copy).map((f) => f.text));
  return (before, after) => {
    const fields: [string | undefined, number][] = [
      [after.headline, COPY_LIMITS.headline],
      [after.subheadline, COPY_LIMITS.subheadline],
      [after.cta, COPY_LIMITS.cta],
      ...after.footerLines.map((line): [string, number] => [
        line,
        COPY_LIMITS.footerLine,
      ]),
    ];
    if (fields.some(([text, max]) => text && copyFault(text, max, ledger))) {
      return false;
    }
    if (fields.some(([text]) => text && foreignWords(text, sources).length)) {
      return false;
    }
    /* A correction is held to the rules every other rewrite is: the
       button an action, the subheadline never a list (round-7 code
       critic, C1 and C2). */
    if (after.cta && after.cta !== before.cta && !isAction(after.cta)) {
      return false;
    }
    if (
      after.subheadline &&
      after.subheadline !== before.subheadline &&
      readsAsList(after.subheadline)
    ) {
      return false;
    }
    if (
      offering &&
      copyNamesOffering(before, offering) &&
      !copyNamesOffering(after, offering)
    ) {
      return false;
    }
    const was = missing(before);
    return [...missing(after)].every((fact) => was.has(fact));
  };
}

/** The fields a correction changed, as the claim check reads them. */
export function changedFields(
  before: DrawnCopy,
  after: DrawnCopy,
): ClaimCheckField[] {
  const out: ClaimCheckField[] = [];
  const field = (
    id: string,
    name: string,
    text: string | undefined,
    limit: number,
    was: string | undefined,
  ) => {
    if (text && text !== was) out.push({ id, field: name, text, limit });
  };
  field(
    "0.headline",
    "headline",
    after.headline,
    COPY_LIMITS.headline,
    before.headline,
  );
  field(
    "0.subheadline",
    "subheadline",
    after.subheadline,
    COPY_LIMITS.subheadline,
    before.subheadline,
  );
  field("0.cta", "button", after.cta, COPY_LIMITS.cta, before.cta);
  after.footerLines.forEach((line, j) => {
    if (!before.footerLines.includes(line)) {
      field(
        `0.footerLines.${j}`,
        "footer line",
        line,
        COPY_LIMITS.footerLine,
        undefined,
      );
    }
  });
  return out;
}

/**
 * correctionHolds, then the same claim check the directions passed, on the
 * fields the correction changed: a judge rewrite is new copy, and the
 * pattern checks cannot read a promise like "free delivery" in another
 * language (round-5 code critic). Fail-closed: new model-written copy is
 * never delivered unread, so an unreachable check refuses it and the copy
 * it would have replaced stands (Oluwaseyi's ruling, round 7; round-6 code
 * critic: a "Hand-woven" merge shipped while the check was down).
 */
export function correctionCheck({
  ledger,
  facts,
  offering,
  checker,
  briefText,
  title,
  brand,
}: {
  ledger: FactLedger;
  facts: readonly BriefFact[];
  offering: string;
  checker: ClaimChecker;
  briefText: string;
  title: string;
  brand: BrandSummary;
}): (before: DrawnCopy, after: DrawnCopy) => Promise<boolean> {
  const holds = correctionHolds(ledger, facts, { offering });
  return async (before, after) => {
    if (!holds(before, after)) return false;
    const fields = changedFields(before, after);
    if (fields.length === 0) return true;
    const flagged = await checker({ fields, briefText, title, brand });
    return flagged !== null && flagged.length === 0;
  };
}

/** A field's text if it can be drawn, its whole clauses if those can, or
 *  null when neither can. */
function fitCopy(
  text: string | undefined,
  max: number,
  ledger: FactLedger,
): string | null {
  const whole = clean(text);
  if (!whole) return null;
  if (!copyFault(whole, max, ledger)) return whole;
  const clauses = clampAtClause(whole, max);
  return clauses && !copyFault(clauses, max, ledger) ? clauses : null;
}

export interface FinalizeReport {
  /** Copy fields that could not be drawn as the model wrote them, and what
   *  was drawn instead. */
  copyFallbacks: { field: string; from: string; to: string | null }[];
  reasonsDropped: { reason: string; why: string }[];
  /** The model's headline could not be drawn: the direction fails rather
   *  than ship a headline code wrote. */
  headlineLost: boolean;
  /** The product as the model named and described it, before it was held
   *  to the brief (resolveBriefProducts). */
  modelProduct: { name: string; look: string };
}

export function finalizeDirection(
  draft: DirectionDraft,
  {
    aspectRatio,
    checks,
    image = "pending",
    paintedScene,
  }: {
    /** The canvas the user asked for. Both directions are drawn on it,
     *  whatever ratio the model wrote back. */
    aspectRatio: AspectRatio;
    checks: DirectionChecks;
    image?: ImageState;
    /** The scene a KO plate will be painted from. */
    paintedScene?: string;
  },
): { direction: DirectionSpec; report: FinalizeReport } {
  const copyFallbacks: FinalizeReport["copyFallbacks"] = [];
  const fit = (
    field: CopyField | "footer",
    text: string | undefined,
    max: number,
  ) => {
    const out = fitCopy(text, max, checks.ledger);
    if (clean(text) && out !== clean(text)) {
      copyFallbacks.push({ field, from: clean(text), to: out });
    }
    return out;
  };

  /* Model writes, code verifies: a headline the model could not deliver
     is never replaced by code's own words (the brief's internal title, a
     playbook lead, "Design direction"; round-8 code critic, break 3). The
     direction carries no headline and fails before it is drawn. */
  const headline = fit("headline", draft.headline, COPY_LIMITS.headline) ?? "";
  const subheadline = fit(
    "subheadline",
    draft.subheadline,
    COPY_LIMITS.subheadline,
  );
  const fitted = fit("cta", draft.cta, COPY_LIMITS.cta);
  /* A button that is not an action is left off rather than drawn: "First
     session free" on a button reads as a label to tap (round-6 eval,
     tutoring-ko). The fit pass asked the model for an action first. */
  const cta = fitted && isAction(fitted) ? fitted : null;
  if (fitted && !cta) {
    copyFallbacks.push({ field: "cta", from: fitted, to: null });
  }
  const footerLines = (draft.footerLines ?? [])
    .map((line) => fit("footer", line, COPY_LIMITS.footerLine))
    .filter((line): line is string => Boolean(line));

  /* The direction's name is the model's too: when no clause of it fits,
     it is left empty, never a playbook lead or a word code chose (round-9
     code critic). The design itself is unaffected. */
  const title = clampAtClause(draft.title, COPY_LIMITS.title) ?? "";
  if (!title) {
    copyFallbacks.push({ field: "title", from: draft.title, to: null });
  }

  const product = productFromBrief(
    draft.productName,
    `${checks.briefText} ${checks.title}`,
  );
  const productLook = product
    ? clean(draft.productLook).slice(0, DRAFT_LIMITS.productLook)
    : "";

  const copy: DrawnCopy = {
    headline,
    subheadline: subheadline ?? undefined,
    cta: cta ?? undefined,
    footerLines,
  };
  const { reasons, dropped } = settleReasons(draft.rationale, {
    copy,
    checks,
    product,
    image,
    paintedScene,
  });

  const { subheadline: _sub, cta: _cta, ...rest } = draft;
  return {
    direction: {
      ...rest,
      ...(copy.subheadline ? { subheadline: copy.subheadline } : {}),
      ...(copy.cta ? { cta: copy.cta } : {}),
      headline,
      footerLines,
      footerStyle: footerLines.length > 0 ? draft.footerStyle : "none",
      aspectRatio,
      title,
      rationale: reasons,
      productName: product,
      productLook,
    },
    report: {
      copyFallbacks,
      reasonsDropped: dropped,
      headlineLost: !headline,
      modelProduct: {
        name: clean(draft.productName),
        look: clean(draft.productLook).slice(0, DRAFT_LIMITS.productLook),
      },
    },
  };
}
