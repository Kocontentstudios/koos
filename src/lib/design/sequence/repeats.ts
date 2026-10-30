import {
  aboveRepeats,
  type BriefFact,
  drawnText,
  dropFooterRepeats,
  factStated,
  headlineFooterRepeats,
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
 * used as its line). The first eval round's judge read exactly this as
 * "one message cut into pieces" (nonRepetitive 2.25 of 5).
 *
 * Not a contract rule: a repeat is drawable, so the job never fails a set
 * for one. The planner asks the repair pass to take them out, keeps a
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

/* A number given on two frames is one point made twice even when no fact
   of the brief names it: round 2's cafe set opened on "18 hours in the
   making" and followed with "18 hours. Not a minute less." */
function numberRepeats(
  frames: readonly FrameBeat[],
  offering: string,
): FrameRepeat[] {
  const named = numbersIn(offering);
  const seen = new Map<string, number>();
  const out: FrameRepeat[] = [];
  frames.forEach((beat, j) => {
    const numbers = [...numbersIn(drawnText(frameCopy(beat)))].filter(
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
   the lines around them differ: round-1 critic, the baking set said "in our
   working kitchen" on frames 2 and 4, and the judge marked it down. A
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
   the close before the viewer gets there: round 2, the cafe set's price
   frame said "Reserve a bottle before you arrive" over "WhatsApp to
   reserve", and the judge read the close as said twice. Only the button's
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
    ...numberRepeats(frames, offering ?? "").filter(
      (r) => !factFrames.has(r.frame),
    ),
    ...lines,
    ...phraseRepeats(frames, facts, free).filter(
      (r) => !factFrames.has(r.frame) && !lineFrames.has(r.frame),
    ),
    ...actionPreviews(frames, free),
  ];
}

/**
 * Each frame without what it says twice, where dropping it loses no fact
 * the frame states: a subheadline that only restates its headline, and
 * footer items the copy above or another item already carries (the
 * directions' own drops, withoutRepeatingSubheadline and
 * dropFooterRepeats), and footer lines that only give facts another frame
 * states (withoutRecap). Code drops; it never rewrites.
 */
export function withoutRepeats(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
  offering: string | null,
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
  );
}

/* A contact is how to act, so it may sit on the action frame whatever an
   earlier frame said; the offering is named where a point needs it. */
const RECAP_EXEMPT = new Set<BriefFact["kind"]>(["contact", "product"]);

/**
 * Footer lines that only give again facts a frame before them states: the
 * last frame recapping the date, time and place the frame before it gave
 * (eval round 2: "Saturday 15 November" and "8am – 2pm · Yaba bar" under
 * "Reserve a bottle before Saturday", after frame 4 said both). Every
 * fact a dropped line gave is still on the set, on the earlier frame; a
 * line that gives anything else (a contact, a fact no earlier frame
 * states) stays.
 */
export function withoutRecap(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
): FrameBeat[] {
  const copies = frames.map(frameCopy);
  return frames.map((beat, j) => {
    const footerLines = beat.footerLines.filter((line) => {
      const lineCopy = {
        headline: "",
        subheadline: "",
        cta: "",
        footerLines: [line],
      };
      const given = facts.filter((fact) => factStated(fact, lineCopy));
      if (given.length === 0) return true;
      return !given.every(
        (fact) =>
          !RECAP_EXEMPT.has(fact.kind) &&
          copies.slice(0, j).some((earlier) => factStated(fact, earlier)),
      );
    });
    return footerLines.length === beat.footerLines.length
      ? beat
      : { ...beat, footerLines };
  });
}
