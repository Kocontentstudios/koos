/**
 * Word-level comparison for directions: how much two directions say the same
 * thing, and the words a reason should not be made of.
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

/** The words of `text` whose stems `exclude` does not hold, one per stem,
 *  as written (lowercased): what a direction says beyond the brief, in
 *  words a writer can be told to leave alone. */
export function distinctiveWords(
  text: string | null | undefined,
  exclude: ReadonlySet<string> = new Set(),
): string[] {
  const words = new Map<string, string>();
  for (const token of (text ?? "").toLowerCase().match(/[\p{L}\p{N}']+/gu) ??
    []) {
    const word = token.replace(/^'+|'+$/g, "");
    const [s] = contentStems(word, exclude);
    if (s && !words.has(s)) words.set(s, word);
  }
  return [...words.values()];
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
  /** What the brief's product looks like. Every KO scene must show it, so
   *  its words are not evidence that two scenes are one. */
  productLook?: string;
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
  const headline = headlineOverlap(a.headline, b.headline, ignore);
  const copy = jaccard(
    contentStems(copyOf(a), beyondBrief),
    contentStems(copyOf(b), beyondBrief),
  );
  const title = jaccard(
    contentStems(a.title, ignore),
    contentStems(b.title, ignore),
  );
  const sceneShared = new Set([
    ...beyondBrief,
    ...contentStems(a.productLook),
    ...contentStems(b.productLook),
  ]);
  const scene = compareScenes
    ? jaccard(
        contentStems(a.backgroundPrompt, sceneShared),
        contentStems(b.backgroundPrompt, sceneShared),
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

/* Two headlines share an idea through at least this many content words.
   One shared word ("Slow mornings" against "Slow down") is a word, not an
   idea (round-15 code critic, finding 5). */
const MIN_SHARED_STEMS = 2;

/* Every word stemmed, stop words kept: what two headlines of stop words
   ("It's all for you", "All for you") still share. */
const allStems = (text: string, ignore: ReadonlySet<string>) =>
  new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .map(stem)
      .filter((s) => !ignore.has(s)),
  );

/* "We're" and "It's" are a stop word and its verb, not a content word
   ("We're hiring" against "Now hiring"). */
const withoutContractions = (text: string) =>
  text.replace(/['’](?:re|s|ll|ve|d|m)\b/gi, "");

const wordCount = (text: string) =>
  text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

const contains = (outer: ReadonlySet<string>, inner: ReadonlySet<string>) =>
  [...inner].every((s) => outer.has(s));

/** How much two headlines say the same words: the headline score of
 *  directionOverlap.
 *  - Two content words shared: content words decide.
 *  - None shared: two headlines of stop words, or one that only adds
 *    words to the other ("All for you, always"), are compared whole,
 *    stop words kept ("All for you" meets "It's all for you"); otherwise
 *    a different content word is a different idea ("Made for you"
 *    against "Baked for you").
 *  - One shared, and it is each headline's only content word: the same
 *    idea when the shorter is two words or fewer, the word and one other
 *    ("We're hiring" against "Now hiring", "Our croissants" against
 *    "Croissants for you"), round-16 code critic, finding 2. Longer
 *    headlines say more around it ("Bake with us" against "Bake it
 *    yourself"), and one shared content word counts no further than the
 *    whole wording agrees ("Slow mornings" against "Slow down"). */
export function headlineOverlap(
  a: string,
  b: string,
  ignore: ReadonlySet<string> = new Set(),
): number {
  const [sa, sb] = [contentStems(a, ignore), contentStems(b, ignore)];
  const content = jaccard(sa, sb);
  const [wa, wb] = [allStems(a, ignore), allStems(b, ignore)];
  const whole = jaccard(wa, wb);
  const shared = [...sa].filter((s) => sb.has(s)).length;
  if (shared >= MIN_SHARED_STEMS) return content;
  if (shared === 0) {
    const stopWordsOnly = sa.size === 0 && sb.size === 0;
    return stopWordsOnly || contains(wa, wb) || contains(wb, wa)
      ? whole
      : content;
  }
  const [ca, cb] = [a, b].map((h) =>
    contentStems(withoutContractions(h), ignore),
  );
  const sameOnlyWord = ca.size === 1 && cb.size === 1;
  if (sameOnlyWord && Math.min(wordCount(a), wordCount(b)) <= 2) return 1;
  return Math.min(content, whole);
}

/** Whether two headlines would read as one design drawn twice: the
 *  headline overlap at the pair check's threshold. */
export function isNearDuplicateHeadline(
  a: string,
  b: string,
  ignore: ReadonlySet<string> = new Set(),
): boolean {
  return headlineOverlap(a, b, ignore) >= NEAR_DUPLICATE.headline;
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
