import {
  aboveRepeats,
  type BriefFact,
  drawnText,
  dropFooterRepeats,
  factStated,
  headlineFooterRepeats,
  isFragment,
  numbersIn,
  redundantFooterItems,
  withoutRepeatingSubheadline,
} from "@/lib/jobs/directions/brief-facts";
import {
  contentStems,
  isNearDuplicateHeadline,
  stem,
} from "@/lib/jobs/directions/text-overlap";
import type { FrameBeat } from "./contract";
import { namesFree } from "./hook";
import { frameCopy } from "./validate";

/**
 * Copy a set says twice: inside one frame (a subheadline restating its
 * headline, a footer item restating the copy above), or across frames (a
 * fact given again on a later frame, a subheadline another frame already
 * used as its line). A reader takes exactly this as "one message cut into
 * pieces".
 *
 * Not a contract rule: a repeat is drawable, so the job never fails a set
 * for one. The planner asks the fix call to take them out, keeps a
 * rewrite only when it leaves fewer, and drops a repeating subheadline in
 * code when nothing is lost (withoutRepeatingSubheadline).
 */

export interface FrameRepeat {
  frame: number;
  detail: string;
}

function withinFrame(beat: FrameBeat, index: number, offering: string) {
  const copy = frameCopy(beat);
  return [
    ...aboveRepeats(copy),
    ...headlineFooterRepeats(copy).map(
      (item) => `the footer item "${item}" gives the headline's value again`,
    ),
    ...redundantFooterItems(copy, offering).map(
      (item) => `the footer item "${item}" says what the copy above says`,
    ),
  ].map((detail) => ({ frame: index, detail }));
}

/* The offering is named on the hook and may be named again where a point
   needs it; every other fact is said once. */
function factRepeats(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
): FrameRepeat[] {
  const out: FrameRepeat[] = [];
  for (const fact of facts) {
    if (fact.kind === "product") continue;
    const stating = frames
      .map((beat, i) => (factStated(fact, frameCopy(beat)) ? i : -1))
      .filter((i) => i >= 0);
    for (const later of stating.slice(1)) {
      out.push({
        frame: later,
        detail: `it gives "${fact.text}" again, which frame ${stating[0] + 1} already states`,
      });
    }
  }
  return out;
}

/* A frame's lines against every earlier frame's: a line another frame
   already used, in other words. Two headlines alike are validateSequence's
   headline-repeat, a contract rule, so only the other pairings count here. */
function lineRepeats(frames: readonly FrameBeat[]): FrameRepeat[] {
  const out: FrameRepeat[] = [];
  const linesOf = (beat: FrameBeat) =>
    [
      { line: beat.headline, headline: true },
      { line: beat.subheadline, headline: false },
    ].filter((l) => l.line.trim());
  frames.forEach((beat, j) => {
    for (let i = 0; i < j; i += 1) {
      const echo = linesOf(beat).find((mine) =>
        linesOf(frames[i]).some(
          (said) =>
            !(mine.headline && said.headline) &&
            isNearDuplicateHeadline(said.line, mine.line),
        ),
      );
      if (echo) {
        out.push({
          frame: j,
          detail: `"${echo.line}" says what frame ${i + 1} already says`,
        });
        return;
      }
    }
  });
  return out;
}

/* "One" and "two" are words more than counts ("for two", "one bottle"). */
const PLAIN_WORDS = new Set(["1", "2"]);

/** `text` without the words of every brief fact written in it. */
function withoutFactTexts(text: string, facts: readonly BriefFact[]): string {
  let rest = text;
  for (const fact of facts) {
    rest = rest.replace(
      new RegExp(fact.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
      " ",
    );
  }
  return rest;
}

/* A number given on two frames is one point made twice even when no fact
   of the brief names it ("18 hours in the making", then "18 hours. Not a
   minute less."). A number inside a brief fact is the fact check's
   (factRepeats): "Launches on 3 March" and "Free for your first 3 months"
   are two facts that share a digit, not one said twice. */
function numberRepeats(
  frames: readonly FrameBeat[],
  offering: string,
  facts: readonly BriefFact[],
): FrameRepeat[] {
  const named = numbersIn(offering);
  const seen = new Map<string, number>();
  const out: FrameRepeat[] = [];
  frames.forEach((beat, j) => {
    const said = withoutFactTexts(drawnText(frameCopy(beat)), facts);
    const numbers = [...numbersIn(said)].filter(
      (n) => !PLAIN_WORDS.has(n) && !named.has(n),
    );
    const again = numbers.find((n) => seen.has(n));
    if (again !== undefined) {
      out.push({
        frame: j,
        detail: `it gives ${again} again, which frame ${(seen.get(again) ?? 0) + 1} already gives`,
      });
    }
    for (const n of numbers) if (!seen.has(n)) seen.set(n, j);
  });
  return out;
}

const PHRASE_WORDS = 3;
const PHRASE_CONTENT_WORDS = 2;

/** Every run of PHRASE_WORDS words in `text` holding at least two content
 *  words, keyed by stems, with the words as written. */
function phrasesOf(text: string): Map<string, string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const phrases = new Map<string, string>();
  for (let i = 0; i + PHRASE_WORDS <= words.length; i += 1) {
    const run = words.slice(i, i + PHRASE_WORDS);
    const content = run.filter((w) => contentStems(w).size > 0).length;
    if (content < PHRASE_CONTENT_WORDS) continue;
    phrases.set(run.map(stem).join(" "), run.join(" "));
  }
  return phrases;
}

/* The same few words on two frames read as one line said twice even when
   the lines around them differ ("in our working kitchen" on frames 2 and
   4). A
   brief fact said twice is factRepeats'; the offering's and the brand's
   names may be said on any frame; two headlines alike are validateSequence's
   headline-repeat. */
function phraseRepeats(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
  free: ReadonlySet<string>,
): FrameRepeat[] {
  const factTexts = facts.map((f) => f.text.toLowerCase());
  const seen = new Map<string, { frame: number; headline: boolean }[]>();
  const out: FrameRepeat[] = [];
  frames.forEach((beat, j) => {
    const lines = [
      { phrases: phrasesOf(beat.headline), headline: true },
      { phrases: phrasesOf(beat.subheadline), headline: false },
    ];
    let reported = false;
    for (const { phrases, headline } of lines) {
      for (const [key, words] of phrases) {
        const said = seen.get(key) ?? [];
        const own =
          [...contentStems(words)].every((s) => free.has(s)) ||
          factTexts.some((text) => text.includes(words));
        const earlier = said.find(
          (s) => s.frame !== j && !(s.headline && headline),
        );
        if (earlier && !own && !reported) {
          out.push({
            frame: j,
            detail: `it says "${words}", which frame ${earlier.frame + 1} already says; say this frame's point in its own words`,
          });
          reported = true;
        }
        seen.set(key, [...said, { frame: j, headline }]);
      }
    }
  });
  return out;
}

/* The action is the last frame's, so a middle frame asking for it spends
   the close before the viewer gets there ("Reserve a bottle before you
   arrive" over a close of "WhatsApp to reserve" is the close said twice).
   Only the button's
   verb counts: "bottle" in "Reserve a bottle" is the price frame's too. */
const ACTION_VERBS = new Set(
  [
    "reserve",
    "book",
    "order",
    "buy",
    "sign",
    "register",
    "join",
    "shop",
    "visit",
    "call",
    "message",
    "apply",
    "claim",
    "start",
    "try",
    "download",
    "subscribe",
    "rsvp",
    "enrol",
    "enroll",
    "secure",
    "grab",
  ].map(stem),
);

function actionPreviews(
  frames: readonly FrameBeat[],
  free: ReadonlySet<string>,
): FrameRepeat[] {
  const last = frames.length - 1;
  const verbs = [...contentStems(frames[last]?.cta ?? "", free)].filter((s) =>
    ACTION_VERBS.has(s),
  );
  if (verbs.length === 0) return [];
  const out: FrameRepeat[] = [];
  frames.forEach((beat, i) => {
    if (i === 0 || i === last) return;
    const said = contentStems(`${beat.headline} ${beat.subheadline}`, free);
    if (verbs.some((s) => said.has(s))) {
      out.push({
        frame: i,
        detail: `it asks for the action ("${frames[last].cta}") the last frame carries; keep this frame to its own point`,
      });
    }
  });
  return out;
}

/* Two headlines built on the same words are one idea headlined twice even
   when the near-duplicate check (validateSequence) passes them ("Late
   deliveries? We chase them." and "Late delivery? Handled."). Any two
   frames, not only neighbours, since the reader remembers the headline. */
const IDEA_STEMS = 2;

export function headlineIdeaRepeats(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
  free: ReadonlySet<string>,
): FrameRepeat[] {
  const factStems = new Set(facts.flatMap((f) => [...contentStems(f.text)]));
  const ignore = new Set([...free, ...factStems]);
  const out: FrameRepeat[] = [];
  frames.forEach((beat, j) => {
    const mine = contentStems(beat.headline, ignore);
    for (let i = 0; i < j; i += 1) {
      if (isNearDuplicateHeadline(frames[i].headline, beat.headline, free)) {
        continue;
      }
      const shared = [...contentStems(frames[i].headline, ignore)].filter((s) =>
        mine.has(s),
      );
      if (shared.length >= IDEA_STEMS) {
        out.push({
          frame: j,
          detail: `its headline "${beat.headline}" is built on the words of frame ${i + 1}'s "${frames[i].headline}", one idea headlined twice; give this frame a different point`,
        });
        return;
      }
    }
  });
  return out;
}

export function sequenceRepeats(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
  offering: string | null,
  brandName = "",
): FrameRepeat[] {
  const byFact = factRepeats(frames, facts);
  const factFrames = new Set(byFact.map((r) => r.frame));
  const lines = lineRepeats(frames);
  const lineFrames = new Set(lines.map((r) => r.frame));
  const free = namesFree(brandName, offering);
  return [
    ...frames.flatMap((beat, i) => withinFrame(beat, i, offering ?? "")),
    ...byFact,
    ...numberRepeats(frames, offering ?? "", facts).filter(
      (r) => !factFrames.has(r.frame),
    ),
    ...lines,
    ...phraseRepeats(frames, facts, free).filter(
      (r) => !factFrames.has(r.frame) && !lineFrames.has(r.frame),
    ),
    ...actionPreviews(frames, free),
    ...headlineIdeaRepeats(frames, facts, free).filter(
      (r) => !lineFrames.has(r.frame),
    ),
  ];
}

/**
 * Each frame without what it says twice, where dropping it loses no fact
 * the frame states: a subheadline that only restates its headline, and
 * footer items the copy above or another item already carries (the
 * directions' own drops, withoutRepeatingSubheadline and
 * dropFooterRepeats), and the words of a fact another frame keeps
 * (withoutRecap). Code drops; it never rewrites.
 */
export function withoutRepeats(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
  offering: string | null,
  owners: readonly (readonly number[])[] = [],
): FrameBeat[] {
  const copies = frames.map((beat) =>
    withoutRepeatingSubheadline(
      { ...frameCopy(beat), footerStyle: "text" as const },
      facts,
    ),
  );
  const { directions } = dropFooterRepeats(copies, facts, offering ?? "");
  return withoutRecap(
    frames.map((beat, i) => ({
      ...beat,
      subheadline: directions[i].subheadline ?? "",
      footerLines: directions[i].footerLines,
    })),
    facts,
    owners,
  );
}

/* A contact is how to act, so it may sit on the action frame whatever an
   earlier frame said; the offering is named where a point needs it. */
const RECAP_EXEMPT = new Set<BriefFact["kind"]>(["contact", "product"]);

const asLine = (text: string) => ({
  headline: "",
  subheadline: "",
  cta: "",
  footerLines: [text],
});

/* Marks that join the pieces of a line ("Saturday 22 November · 10am to
   1pm", "₦2,500 a bottle, 8am to 2pm"), which go with the piece dropped. */
const JOINER = "\\s,;:·|•—–\\-";
const TRAILING_JOINERS = new RegExp(`[${JOINER}]+$`);
const LEADING_JOINERS = new RegExp(`^[${JOINER}.!?]+`);
/* A word that leans on what was dropped: "Reserve before" alone, "on, 10am
   to 1pm". Such a remainder is refused rather than rewritten. */
const LEANING =
  /^(?:on|at|from|by|in|for|to|and|or|until|till|before|after|this|every|the|of|with|across|near|around|into|onto|inside|within|throughout|over|under|beside|serving|covering|including)$/i;
const SENTENCE_END = /[.!?]$/;

function joined(left: string, gap: string, right: string): string | null {
  if (!left) return right;
  if (!right) return left;
  if (SENTENCE_END.test(left)) {
    return /^[\p{Lu}\p{N}₦$£€]/u.test(right) ? `${left} ${right}` : null;
  }
  const mark = gap.replace(/\s+/g, "").slice(0, 1);
  if (!mark) return `${left} ${right}`;
  return /[,;:]/.test(mark)
    ? `${left}${mark} ${right}`
    : `${left} ${mark} ${right}`;
}

/**
 * `text` without `fact`'s words where the brief's words stand in it whole,
 * with the mark that joined them, when what is left still reads on its
 * own: null when the fact is not written word for word, or the rest would
 * lean on the dropped words. Words are only ever dropped, never written.
 */
export function withoutFactWords(text: string, fact: BriefFact): string | null {
  const at = text.toLowerCase().indexOf(fact.text.toLowerCase());
  if (at < 0) return null;
  const end = at + fact.text.length;
  const wordChar = /[\p{L}\p{N}]/u;
  if (wordChar.test(text[at - 1] ?? "") || wordChar.test(text[end] ?? "")) {
    return null;
  }
  const before = text.slice(0, at);
  const after = text.slice(end);
  const left = before.replace(TRAILING_JOINERS, "");
  const right = after.replace(LEADING_JOINERS, "").trim();
  const edgeWords = [left.split(/\s+/).at(-1) ?? "", right.split(/\s+/)[0]];
  if (edgeWords.some((w) => LEANING.test(w.replace(/[^\p{L}]/gu, "")))) {
    return null;
  }
  const gap =
    before.slice(left.length) || (after.match(LEADING_JOINERS)?.[0] ?? "");
  const rest = joined(left.trim(), gap, right);
  if (rest === null) return null;
  /* One word left is never a line: "Serving" from "Serving Lekki Phase 1"
     with the place dropped. */
  if (rest !== "" && rest.split(/\s+/).length < 2) return null;
  return rest === "" || /[\p{L}\p{N}]/u.test(rest) ? rest : null;
}

const writtenIn = (text: string, fact: BriefFact) =>
  text.toLowerCase().includes(fact.text.toLowerCase());

/** `text` without the words of the facts in `drop`, one at a time, where
 *  each stands whole and the rest still states `keep` and reads on its
 *  own; `text` itself when no drop can be made. */
function withoutRepeatedFacts(
  text: string,
  drop: readonly BriefFact[],
  keep: readonly BriefFact[],
): string {
  let current = text;
  for (const fact of drop) {
    const rest = withoutFactWords(current, fact);
    if (rest === null || (rest && isFragment(rest))) continue;
    if (keep.every((k) => factStated(k, asLine(rest)))) current = rest;
  }
  return current;
}

/** The fields a frame draws, headline first. */
function fieldsOf(beat: FrameBeat): string[] {
  return [beat.headline, beat.subheadline, ...beat.footerLines].filter(Boolean);
}

/** How plainly a frame gives `fact`: the fewest other facts written in
 *  the field that states it, or null when no field does. */
function crowding(
  beat: FrameBeat,
  fact: BriefFact,
  facts: readonly BriefFact[],
): number | null {
  const counts = fieldsOf(beat)
    .filter((field) => factStated(fact, asLine(field)))
    .map(
      (field) =>
        facts.filter((other) => other !== fact && writtenIn(field, other))
          .length,
    );
  return counts.length > 0 ? Math.min(...counts) : null;
}

/**
 * The frame that keeps each fact, in order: the frame the arc gave it,
 * where it states it (a copy of the fact on another frame's headline is
 * then a fault the fix call is asked about, never the reason the owner
 * loses it), then one whose headline gives it (a headline is never cut),
 * else the frame that says it most plainly, the earliest of those tied. -1 for a fact no frame states,
 * and for a contact or the offering, which any frame may give.
 */
function factKeepers(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
  owners: readonly (readonly number[])[],
): number[] {
  return facts.map((fact, n) => {
    if (RECAP_EXEMPT.has(fact.kind)) return -1;
    const owner = owners.findIndex((owned) => owned.includes(n));
    if (
      owner >= 0 &&
      frames[owner] &&
      crowding(frames[owner], fact, facts) !== null
    ) {
      return owner;
    }
    const inHeadline = frames.findIndex((beat) =>
      factStated(fact, asLine(beat.headline)),
    );
    if (inHeadline >= 0) return inHeadline;
    let keeper = -1;
    let plainest = Number.POSITIVE_INFINITY;
    frames.forEach((beat, i) => {
      const crowd = crowding(beat, fact, facts);
      if (crowd !== null && crowd < plainest) {
        keeper = i;
        plainest = crowd;
      }
    });
    return keeper;
  });
}

/**
 * Each fact said once, where it belongs: a frame other than the fact's
 * keeper (factKeepers) loses the fact's words from its subheadline and
 * footer lines, a footer line left empty goes, and a headline is never
 * cut: a close whose footer gives the date, time and address another
 * frame already crammed into its subheadline reads as said twice.
 * `owners` is the arc's facts by frame; without it the first frame to
 * state a fact keeps it. Words are only dropped where the brief's words
 * stand whole and the rest reads on its own (withoutFactWords), and the
 * set is returned unchanged if a drop would leave any fact unstated.
 */
export function withoutRecap(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
  owners: readonly (readonly number[])[] = [],
): FrameBeat[] {
  const copies = frames.map(frameCopy);
  const keepers = factKeepers(frames, facts, owners);
  const next = frames.map((beat, j) => {
    const elsewhere = facts.filter(
      (_, n) => keepers[n] >= 0 && keepers[n] !== j,
    );
    const trimmed = (text: string) => {
      const again = elsewhere.filter((fact) => writtenIn(text, fact));
      if (again.length === 0) return text;
      const keep = facts.filter(
        (fact) => !again.includes(fact) && factStated(fact, asLine(text)),
      );
      return withoutRepeatedFacts(text, again, keep);
    };
    const footerLines = beat.footerLines.map(trimmed).filter(Boolean);
    const subheadline = beat.subheadline ? trimmed(beat.subheadline) : "";
    const unchanged =
      subheadline === beat.subheadline &&
      footerLines.length === beat.footerLines.length &&
      footerLines.every((line, i) => line === beat.footerLines[i]);
    return unchanged ? beat : { ...beat, subheadline, footerLines };
  });
  const lost = facts.some(
    (fact) =>
      copies.some((copy) => factStated(fact, copy)) &&
      !next.some((beat) => factStated(fact, frameCopy(beat))),
  );
  return lost ? [...frames] : next;
}

/** The facts one frame gives in two of its fields (the subheadline and
 *  again in a footer line): read as the frame saying it twice. */
export function factsTwiceInFrame(
  beat: FrameBeat,
  facts: readonly BriefFact[],
): BriefFact[] {
  const fields = [
    beat.headline,
    beat.subheadline,
    beat.cta,
    ...beat.footerLines,
  ].filter((text) => text.trim());
  return facts.filter(
    (fact) =>
      fact.kind !== "product" &&
      fields.filter((text) => factStated(fact, text)).length > 1,
  );
}
