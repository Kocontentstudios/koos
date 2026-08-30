/**
 * Single adjectives, not the compound `toneOptions` the manual form uses.
 *
 * Whatever is picked here becomes the `tone` column, and toneBadges splits
 * that back into one badge per adjective for the snapshot card — so offering
 * adjectives in the first place keeps both ends speaking the same language.
 */
export const VOICE_TONE_CHIPS = [
  "Bold",
  "Punchy",
  "Playful",
  "Friendly",
  "Warm",
  "Authoritative",
  "Sophisticated",
  "Modern",
  "Minimal",
  "Premium",
] as const;

/** Filler and cliché a brand usually wants ruled out. */
export const WORDS_TO_AVOID_CHIPS = [
  "Synergy",
  "Cheap",
  "Guaranteed",
  "Revolutionary",
  "Disruptive",
  "World-class",
  "Cutting-edge",
  "Game-changer",
  "Leverage",
  "Best-in-class",
] as const;

/** The ticket's own examples, plus the differentiators a small brand actually
 *  claims. Free text covers the rest — a brand's real edge is often specific
 *  enough that no fixed list would carry it. */
export const DIFFERENTIATION_CHIPS = [
  "Higher quality",
  "AI-powered speed",
  "Bespoke service",
  "Niche specialization",
  "Faster turnaround",
  "Better price",
  "Local expertise",
  "Proven results",
] as const;

/** What competitors are good at. The mirror of the question above, and the
 *  half that tells a strategy where NOT to compete head-on. */
export const COMPETITOR_STRENGTH_CHIPS = [
  "Bigger budget",
  "Longer track record",
  "Wider reach",
  "Lower prices",
  "Stronger community",
  "Broader product range",
  "Better distribution",
  "Household name",
] as const;

export type ChipPrompt =
  | "tone"
  | "avoid"
  | "differentiation"
  | "competitor-strengths";

/** toneBadges renders at most this many before it stops, so selecting more
 *  than this would silently lose the tail on the snapshot card. Applies to
 *  every chip set for consistency; only `tone` is actually constrained by it. */
export const MAX_CHIP_SELECTION = 6;

/* Deliberately narrow. This runs against arbitrary model prose, and a false
   positive puts irrelevant chips under an unrelated question, which reads as
   a bug. Both patterns demand the specific subject, not just a keyword. */
const AVOID_SUBJECT = "(?:words?|phrases?|terms?|language|jargon)";
/* "never want" included because the prompt's own topic 5 says "anything ...
   that they never want associated with them", so the model echoes it — and
   without it that phrasing silently showed no chips. */
const AVOID_VERB =
  "(?:avoid|never (?:use|say|want)|steer clear|stay away|don'?t (?:use|say|want))";
/* Either order: "words to avoid" and "avoid any words like" both count, and
   so does "language you want to steer clear of". */
const AVOID_PATTERN = new RegExp(
  `\\b${AVOID_SUBJECT}\\b[^.?!]{0,40}\\b${AVOID_VERB}\\b|\\b${AVOID_VERB}\\b[^.?!]{0,25}\\b${AVOID_SUBJECT}\\b`,
  "i",
);

/**
 * The model states which poll it is asking, in a marker it appends to the
 * message; the client strips it before rendering.
 *
 * The competitor pair cannot be told apart by pattern. "What do you do better
 * than those competitors?" and "What do those competitors do better than
 * you?" share every keyword and differ only in the direction of the
 * comparison, and after the names question the subject is usually a proper
 * noun ("What is Cocoa Bloom good at?") with no competitor token left to
 * match at all. Deciding which question was asked is the model's job — it just
 * wrote it — so it says so, and the client parses a token rather than prose.
 */
const POLL_MARKER = /\[\[poll:([^\]]*)\]\]/i;

/* Kind-agnostic, and tolerant of how a model actually writes a token it was
   told to append: wrapped in backticks, bolded, or alone in a fence. Stripping
   is deliberately WIDER than parsing — an unrecognised kind must still be
   removed, or a one-character slip leaks the raw protocol onto the screen on
   top of losing the poll. */
/* Three shapes, tried in order: fenced, wrapped, bare. A wrapper is consumed
   only when the SAME delimiter closes it (backreference), because matching
   [`*_~] independently on each side ate the closing fence of a neighbouring
   code block and the trailing ** of adjacent bold — and that is written to
   the database, so it is not recoverable in a renderer.

   No LEADING whitespace run: with no literal to anchor on it backtracks from
   every offset in a run of spaces. Only the trailing run is consumed, and the
   replacer below decides whether to rejoin. */
const POLL_MARKER_ANYWHERE = new RegExp(
  "(?:" +
    "(`{3,10})[^\\S\\n]*\\n?\\[\\[poll:[^\\]]*?\\]\\]+\\n?[^\\S\\n]*\\1" +
    "|([`*_~]{1,3})\\[\\[poll:[^\\]]*?\\]\\]+\\2" +
    "|\\[\\[poll:[^\\]]*?\\]\\]+" +
    ")[^\\S\\n]*",
  "gi",
);

/* A marker still arriving. The message renders on every chunk and the prompt
   puts the marker last, so without this the user watches "[[poll:different"
   type itself out on four of the nine onboarding turns. The optional trailing
   `]` covers the one-character-from-complete state, which the closing `]]`
   pattern above cannot match. */
/* No leading `[^\S\n]*`: with no `[` to anchor on it forces a full backtrack
   from every offset in a trailing whitespace run — 80k spaces took 3s, 200k
   took 88s, and this runs on every message on every render. The trailing
   `\s+$` trim below already removes that whitespace. */
const PARTIAL_MARKER_AT_END = /\[\[?(?:p(?:o(?:l(?:l(?::[^\]\n]*\]?)?)?)?)?)?$/;

const MARKER_KINDS: Record<string, ChipPrompt> = {
  tone: "tone",
  avoid: "avoid",
  differentiation: "differentiation",
  "competitor-strengths": "competitor-strengths",
  /* Aliases for the names the model is most likely to reach for instead: the
     database column, and the plural of the kind. */
  differentiators: "differentiation",
  "competitor-strength": "competitor-strengths",
};

/** The marker as the prompt asks the model to write it. */
export function pollMarker(kind: ChipPrompt): string {
  return `[[poll:${kind}]]`;
}

/** Removes the marker before the message is stored, shown, spoken or sent to
    the extractor. Applied at the persistence boundary, so history written
    before this shipped is also cleaned on the way back out. */
export function stripPollMarker(text: string): string {
  /* Scoped to the removal site. Collapsing whitespace across the whole message
     would reformat every stored chat turn in every mode — two-space list
     indents, four-space code blocks and markdown hard breaks all carry
     meaning, and the result is written to the database. */
  return text
    .replace(POLL_MARKER_ANYWHERE, (...args: unknown[]) => {
      /* Read from the END: the pattern has capture groups, so offset and the
         whole string sit after them rather than at fixed positions. */
      const match = args[0] as string;
      const whole = args[args.length - 1] as string;
      const offset = args[args.length - 2] as number;
      const before = whole[offset - 1];
      const after = whole[offset + match.length];
      /* The leading space is NOT consumed, so "A [[poll]] B" already keeps
         one separator; a space is only reinserted when the marker sat flush
         between two words. */
      const joinsTwoWords =
        before !== undefined &&
        after !== undefined &&
        !/\s/.test(before) &&
        !/\s/.test(after);
      return joinsTwoWords ? " " : "";
    })
    .replace(PARTIAL_MARKER_AT_END, "")
    .trimEnd();
}

const TONE_PATTERN =
  /\b(?:tone|voice|personality)\b[^.?!]{0,60}\?|\bhow (?:should|would|do you want) (?:it|the brand|your brand)[^.?!]{0,40}\b(?:sound|feel|come across)\b/i;

/**
 * Which chip set, if any, belongs under this assistant message.
 *
 * Returns null for anything that isn't clearly one of these questions —
 * showing no chips is always safe, showing the wrong ones is not.
 */
export function detectChipPrompt(text: string): ChipPrompt | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;

  /* Underscores and stray spaces normalised to hyphens: competitor-strengths
     is the only hyphenated kind, and snake_case is a routine model slip. */
  /* camelCase, snake_case and stray spaces all normalise to the kebab form.
     competitor-strengths is the only hyphenated kind, so a single character
     decides whether the poll appears at all — and there is no fallback for
     that pair to catch it. */
  const marked = trimmed
    .match(POLL_MARKER)?.[1]
    ?.trim()
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  // Own-property only: "[[poll:constructor]]" would otherwise resolve to a
  // function, survive `?? null`, and crash the picker on render.
  if (marked && Object.hasOwn(MARKER_KINDS, marked))
    return MARKER_KINDS[marked];
  /* A marker the parser does not know falls THROUGH to the prose fallback
     rather than short-circuiting: "[[poll:tonne]]" should not suppress the
     tone chips that the fallback exists to keep working. */

  /* Fallback for tone and words-to-avoid ONLY. Those two have a narrow, stable
     vocabulary and shipped on these patterns, so a model that omits the marker
     still gets chips. There is deliberately NO fallback for the competitor
     pair: guessing them from prose inverts the answer into the wrong column,
     which is worse than showing nothing. */
  const withoutMarker = stripPollMarker(trimmed);
  // Checked first: "what words should we avoid in your voice?" is an avoid
  // question that also mentions voice.
  if (AVOID_PATTERN.test(withoutMarker)) return "avoid";
  if (TONE_PATTERN.test(withoutMarker)) return "tone";
  return null;
}

/**
 * The synthetic user turn a selection produces.
 *
 * Comma-separated because that is what toneBadges splits on and what the
 * extractor reads back out of the transcript. Phrased as the user speaking,
 * since that is exactly what it stands in for.
 */
export function formatChipSelection(
  kind: ChipPrompt,
  selected: string[],
): string {
  const cleaned = selected.map((s) => s.trim()).filter(Boolean);
  if (cleaned.length === 0) return "";
  const list = cleaned.join(", ");
  switch (kind) {
    case "tone":
      return `Our brand voice is: ${list}.`;
    case "avoid":
      return `Words and phrases to avoid: ${list}.`;
    case "differentiation":
      return `What we do better than competitors: ${list}.`;
    case "competitor-strengths":
      return `What our competitors are strong at: ${list}.`;
  }
}
