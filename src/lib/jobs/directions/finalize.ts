import type { AspectRatio } from "@/lib/ai/image/types";
import type { DesignElement } from "@/lib/design/document/schema";
import {
  type DrawnCopy,
  documentParts,
  type FactLedger,
  type ImageState,
  inventedFacts,
  looksCutOff,
  productFromBrief,
  reasonHolds,
} from "./claims";
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
    candidates.push(`The headline names the ${product} straight away`);
  }
  const money = MONEY_IN.exec(drawn)?.[0];
  if (money)
    candidates.push(`It gives the ${money.trim()} price, so nobody has to ask`);
  const time = TIME_IN.exec(drawn)?.[0];
  if (time)
    candidates.push(`It says ${time.trim()}, so people know when to come`);
  const date = DATE_IN.exec(drawn)?.[0] ?? DAY_IN.exec(drawn)?.[0];
  if (date)
    candidates.push(
      `${capitalise(date.trim())} is written on the design itself`,
    );
  if (productStems.length > 0 && (image === "verified" || image === "seen")) {
    candidates.push(`The image shows the ${product} itself`);
  }
  if (copy.cta) candidates.push(`The button asks for one thing: "${copy.cta}"`);
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
    reasons.push("The headline is set larger than every other line");
  }
  if (drawn.subject?.ok) {
    reasons.push("The product is drawn whole, with no copy laid over it");
  }
  const logo = doc.elements.find((e) => e.type === "logo" && !e.hidden);
  const corner = logo ? cornerOf(logo, doc) : null;
  if (corner) reasons.push(`The brand's logo is in the ${corner} corner`);
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
    const whole = `${lead} "${clean}"`;
    if (whole.length <= COPY_LIMITS.reason) return whole;
    const words = clean.split(/\s+/);
    for (let n = words.length - 1; n >= 2; n -= 1) {
      const opening = `${lead.replace(/ reads$| says$| adds$/, " opens with")} "${words.slice(0, n).join(" ")}"`;
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
  if (reasons.length < DIRECTION_REASONS_MIN) {
    reasons.push("Nothing competes with the headline, so it reads at once");
  }
  return reasons;
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
  const topUps = [
    ...factualReasons(settings),
    ...(settings.drawn ? documentReasons(settings.drawn) : []),
    ...copyReasons(settings.copy),
  ];
  for (const extra of topUps) {
    if (out.length >= DIRECTION_REASONS_MIN) break;
    if (out.some((kept) => kept.toLowerCase() === extra.toLowerCase())) {
      continue;
    }
    out.push(extra);
  }
  return { reasons: out.slice(0, DIRECTION_REASONS_MAX), dropped };
}

type CopyField = "headline" | "subheadline" | "cta";

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
  const invented = inventedFacts(whole, ledger);
  if (invented.length > 0) {
    return `states ${invented.join(", ")}, which the brief does not`;
  }
  return null;
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
  /** The product as the model named and described it, before it was held
   *  to the brief (resolveBriefProducts). */
  modelProduct: { name: string; look: string };
}

export function finalizeDirection(
  draft: DirectionDraft,
  {
    aspectRatio,
    checks,
    fallbackTitle,
    image = "pending",
    paintedScene,
  }: {
    /** The canvas the user asked for. Both directions are drawn on it,
     *  whatever ratio the model wrote back. */
    aspectRatio: AspectRatio;
    checks: DirectionChecks;
    /** The concept's lead, for a title that could not be kept. */
    fallbackTitle: string;
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

  const headline =
    fit("headline", draft.headline, COPY_LIMITS.headline) ??
    fitCopy(checks.title, COPY_LIMITS.headline, checks.ledger) ??
    fitCopy(capitalise(fallbackTitle), COPY_LIMITS.headline, checks.ledger) ??
    "Design direction";
  const headlineFallback = copyFallbacks.find((f) => f.field === "headline");
  if (headlineFallback) headlineFallback.to = headline;
  const subheadline = fit(
    "subheadline",
    draft.subheadline,
    COPY_LIMITS.subheadline,
  );
  const cta = fit("cta", draft.cta, COPY_LIMITS.cta);
  const footerLines = (draft.footerLines ?? [])
    .map((line) => fit("footer", line, COPY_LIMITS.footerLine))
    .filter((line): line is string => Boolean(line));

  const title =
    clampAtClause(draft.title, COPY_LIMITS.title) ??
    clampAtClause(capitalise(fallbackTitle), COPY_LIMITS.title) ??
    "Design direction";

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
      modelProduct: {
        name: clean(draft.productName),
        look: clean(draft.productLook).slice(0, DRAFT_LIMITS.productLook),
      },
    },
  };
}
