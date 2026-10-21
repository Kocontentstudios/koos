import type { AspectRatio } from "@/lib/ai/image/types";
import {
  DIRECTION_REASON_MAX,
  DIRECTION_REASONS_MAX,
  DIRECTION_REASONS_MIN,
  DIRECTION_TITLE_MAX,
  type DirectionDraft,
  type DirectionSpec,
} from "./schema";
import {
  contentStems,
  isGroundedReason,
  soundsLikeFiller,
  usesJargon,
} from "./text-overlap";

/**
 * Brings a model draft inside the direction contract, deterministically.
 *
 * Over-long text is shortened at a clause or word boundary, never mid-word
 * and never with an ellipsis: these strings are shown as finished copy on the
 * results card. Reasons are kept best first: ones that name something from
 * the brief, then plain ones, while praise that names nothing ("eye-catching",
 * "clean and modern") and spec jargon (layout ids, hex codes) go first when
 * enough better ones remain. A draft left with fewer than two is topped up
 * from its lens.
 */

const CLAUSE_BREAK = /[,;:]\s|\s[-–—]\s/g;

export function clampText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const window = clean.slice(0, max + 1);
  let cut = -1;
  for (const match of window.matchAll(CLAUSE_BREAK)) {
    if (match.index !== undefined && match.index <= max) cut = match.index;
  }
  /* A clause break in the first half would throw away most of the reason;
     a word boundary keeps more of what was said. */
  if (cut < max * 0.5) cut = window.lastIndexOf(" ");
  if (cut <= 0) cut = max;
  return trimDanglingWords(clean.slice(0, cut));
}

/* A word-boundary cut can stop on "at a" or "and the", which reads as a
   sentence that broke off. Those are dropped until a content word ends it. */
const DANGLING =
  /[\s,;:–—-]+$|\s+(a|an|the|and|or|but|of|to|in|on|at|for|with|without|by|from|as|so|that|than|its|their|your|our|is|are|single|every|each|any|some|more|most|very|own|this|these|those|into|while|when|where|which|who|not|no)$/i;

function trimDanglingWords(text: string): string {
  let out = text.trim();
  for (let previous = ""; previous !== out; ) {
    previous = out;
    out = out.replace(DANGLING, "").trim();
  }
  return out;
}

function finalizeReasons(
  reasons: string[],
  facts: ReadonlySet<string>,
  fallback: string[],
): string[] {
  const seen = new Set<string>();
  const candidates: { text: string; tier: number }[] = [];
  for (const reason of reasons) {
    const text = clampText(reason, DIRECTION_REASON_MAX);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    const grounded = isGroundedReason(text, facts);
    const unfit = usesJargon(text) || (soundsLikeFiller(text) && !grounded);
    /* Best first: names the brief and was written to length, then names the
       brief but had to be shortened, then the rest. A shortened reason is a
       sentence someone cut, so it is shown only when there are not two
       whole ones to show instead. */
    const whole = text === reason.replace(/\s+/g, " ").trim();
    const tier = unfit ? 4 : (grounded ? 0 : 2) + (whole ? 0 : 1);
    candidates.push({ text, tier });
  }

  const kept: string[] = [];
  for (let tier = 0; tier <= 4; tier += 1) {
    const atTier = candidates.filter((c) => c.tier === tier);
    if (tier > 0 && kept.length >= DIRECTION_REASONS_MIN) break;
    kept.push(...atTier.map((c) => c.text));
  }
  /* Within the kept set, the model's own order: it usually leads with the
     reason that matters most. */
  kept.sort(
    (a, b) =>
      candidates.findIndex((c) => c.text === a) -
      candidates.findIndex((c) => c.text === b),
  );

  for (const extra of fallback) {
    if (kept.length >= DIRECTION_REASONS_MIN) break;
    if (!seen.has(extra.toLowerCase())) kept.push(extra);
  }
  return kept.slice(0, DIRECTION_REASONS_MAX);
}

export function finalizeDirection(
  draft: DirectionDraft,
  {
    aspectRatio,
    facts,
    fallbackReasons,
    fallbackTitle,
  }: {
    /** The canvas the user asked for. Both directions are drawn on it,
     *  whatever ratio the model wrote back. */
    aspectRatio: AspectRatio;
    facts: ReadonlySet<string>;
    fallbackReasons: string[];
    fallbackTitle: string;
  },
): DirectionSpec {
  const title =
    clampText(draft.title, DIRECTION_TITLE_MAX) ||
    clampText(fallbackTitle, DIRECTION_TITLE_MAX);
  return {
    ...draft,
    aspectRatio,
    title,
    rationale: finalizeReasons(
      draft.rationale,
      facts,
      fallbackReasons.map((r) => clampText(r, DIRECTION_REASON_MAX)),
    ),
  };
}

/* Words every rationale may use without saying anything about the brief.
   Left in, "uses the brand colours" would count as grounded for any brand
   whose overview happens to say "brand". */
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
  ].map((w) => [...contentStems(w)][0] ?? w),
);

/* A brief that carries a date or a price is answered by a reason about "the
   date" or "the price", which shares no literal word with "Friday 14 March"
   or "₦4,500". These name the kind of fact, and count only when the brief
   actually holds one. */
const WHEN =
  /\b(\d{1,2}(:\d{2})?\s?(am|pm)|(mon|tues|wednes|thurs|fri|satur|sun)day|weekdays?|weekends?|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|june?|july?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;
const WHEN_WORDS = ["date", "time", "day", "deadline", "schedule"];
const PRICE =
  /([₦$£€]\s?\d|\d[\d,]*\s?(naira|ngn|usd|kobo)|\bfree\b|\bfees?\b|\bprice)/i;
const PRICE_WORDS = ["price", "cost", "fee", "free", "offer", "saving"];

/** The content words a reason can be grounded in: the brief and what the
 *  brand says about itself, minus design vocabulary. */
export function groundingFacts(sources: (string | null | undefined)[]) {
  const facts = new Set<string>();
  const add = (words: Iterable<string>) => {
    for (const s of words) if (!DESIGN_VOCABULARY.has(s)) facts.add(s);
  };
  for (const source of sources) {
    add(contentStems(source));
    if (source && WHEN.test(source)) add(contentStems(WHEN_WORDS.join(" ")));
    if (source && PRICE.test(source)) add(contentStems(PRICE_WORDS.join(" ")));
  }
  return facts;
}
