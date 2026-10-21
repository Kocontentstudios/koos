/**
 * Word-level comparison for directions: how much two directions say the same
 * thing, and whether a reason is anchored in what the user actually told us.
 *
 * Deterministic on purpose. "Are these two concepts different?" has a cheap,
 * checkable proxy (do they share their words?) that catches the failure that
 * matters, one idea written twice, without paying a model to have an opinion.
 */

const STOPWORDS = new Set(
  `a about above after again all also am an and any are as at be because been
  before being below best between both but by can could did do does doing down
  during each every few for from further get gets had has have having he her
  here hers him his how i if in into is it its itself just let lets me more
  most my new no nor not now of off on once only or other our ours out over own
  same she should so some such than that the their theirs them then there these
  they this those through to too under until up very was we were what when
  where which while who whom why will with would you your yours yourself one
  make makes made way ways day days thing things`
    .split(/\s+/)
    .filter(Boolean),
);

/** Crude suffix folding, enough that "croissant" and "croissants" or
 *  "baking" and "baked" meet. A real stemmer would be a dependency for a
 *  comparison that only needs to be consistent with itself. */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/'s$/, "");
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss"))
    w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  return w;
}

/** Content-word stems: lowercased, stopwords and one- or two-letter tokens
 *  dropped, digits kept because a price or a date is content. */
export function contentStems(
  text: string | null | undefined,
  ignore: ReadonlySet<string> = new Set(),
): Set<string> {
  const stems = new Set<string>();
  for (const token of (text ?? "").toLowerCase().match(/[\p{L}\p{N}']+/gu) ??
    []) {
    const word = token.replace(/^'+|'+$/g, "");
    if (word.length < 3 && !/^\d+$/.test(word)) continue;
    if (STOPWORDS.has(word)) continue;
    const s = stem(word);
    if (!ignore.has(s)) stems.add(s);
  }
  return stems;
}

/** Shared share of the union. 0 for two empty sets: nothing said twice. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export interface ComparableDirection {
  title: string;
  headline: string;
  subheadline?: string;
  cta?: string;
  backgroundPrompt: string;
}

export interface DirectionOverlap {
  headline: number;
  copy: number;
  title: number;
  /** The painted scene. Only meaningful when each direction gets its own
   *  plate; with one uploaded photo the scenes are the same by design. */
  scene: number | null;
  /** The worst of the above: the score distinctness is measured against. */
  max: number;
}

/* Calibrated on the failure it exists for. "Fresh croissants every morning"
   against "Fresh croissants, every single morning" scores 1.0 on headline;
   two honest concepts for the same bakery ("Baked before sunrise" against
   "Your table is waiting") share nothing. Half the words in common is
   already one idea phrased twice. */
export const NEAR_DUPLICATE = {
  headline: 0.5,
  copy: 0.45,
  title: 0.5,
  scene: 0.6,
} as const;

function copyOf(d: ComparableDirection): string {
  return [d.headline, d.subheadline, d.cta].filter(Boolean).join(" ");
}

export function directionOverlap(
  a: ComparableDirection,
  b: ComparableDirection,
  {
    compareScenes,
    ignore = new Set(),
    briefWords = new Set(),
  }: {
    compareScenes: boolean;
    /** Stems both directions are entitled to share, such as the brand name. */
    ignore?: ReadonlySet<string>;
    /** The brief's own words. Both directions must carry its facts (the
     *  price, the deadline, "apply by"), so the supporting copy and the scene
     *  are compared on what each direction added. The headline and title are
     *  the concept itself and are compared whole: two headlines built from
     *  the same brief words are the same idea. */
    briefWords?: ReadonlySet<string>;
  },
): DirectionOverlap {
  const beyondBrief = new Set([...ignore, ...briefWords]);
  const headline = jaccard(
    contentStems(a.headline, ignore),
    contentStems(b.headline, ignore),
  );
  const copy = jaccard(
    contentStems(copyOf(a), beyondBrief),
    contentStems(copyOf(b), beyondBrief),
  );
  const title = jaccard(
    contentStems(a.title, ignore),
    contentStems(b.title, ignore),
  );
  const scene = compareScenes
    ? jaccard(
        contentStems(a.backgroundPrompt, beyondBrief),
        contentStems(b.backgroundPrompt, beyondBrief),
      )
    : null;
  return {
    headline,
    copy,
    title,
    scene,
    max: Math.max(headline, copy, title, scene ?? 0),
  };
}

export function isNearDuplicate(overlap: DirectionOverlap): boolean {
  return (
    overlap.headline >= NEAR_DUPLICATE.headline ||
    overlap.copy >= NEAR_DUPLICATE.copy ||
    overlap.title >= NEAR_DUPLICATE.title ||
    (overlap.scene !== null && overlap.scene >= NEAR_DUPLICATE.scene)
  );
}

/** 1 means nothing in common; 0 means the same words. */
export function distinctness(overlap: DirectionOverlap): number {
  return 1 - overlap.max;
}

/* Praise any design could claim. A reason made only of this tells the user
   nothing about why THIS design suits THEIR brief. */
const FILLER =
  /\b(eye[- ]catching|stands? out|grabs? (the )?attention|visually (appealing|striking|engaging)|clean and modern|modern and clean|sleek|high[- ]impact|pops?|engaging|professional (look|feel)|aesthetic(ally)? pleasing|draws? the eye|captures? attention)\b/i;

export function soundsLikeFiller(reason: string): boolean {
  return FILLER.test(reason);
}

/* Our vocabulary, not the client's. A results card that says "split-left
   keeps the portrait legible" or "#FDE68A on #065F46" is reading out the
   spec, and "Direction 1" or "the concept brief" leaks the prompt. */
const JARGON =
  /(#[0-9a-f]{3,8}\b|\b(hero-center|split-left|banner-bottom|quote-card|stat-highlight)\b|\bdirection\s*[12]\b|\bconcept brief\b|\bthe lens\b)/i;

export function usesJargon(reason: string): boolean {
  return JARGON.test(reason);
}

/**
 * Whether a reason names something from the brief or the brand: shares at
 * least one content word with them. A reason that only restates its own
 * headline, or only praises the design, shares none.
 */
export function isGroundedReason(
  reason: string,
  facts: ReadonlySet<string>,
): boolean {
  for (const s of contentStems(reason)) if (facts.has(s)) return true;
  return false;
}
