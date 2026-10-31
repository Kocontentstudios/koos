import type { BriefFact } from "@/lib/jobs/directions/brief-facts";
import { copyNamesOffering } from "@/lib/jobs/directions/finalize";
import {
  contentStems,
  isNearDuplicateHeadline,
} from "@/lib/jobs/directions/text-overlap";
import type { FrameBeat } from "./contract";

/**
 * Hooks that give no reason to swipe: an announcement ("Fresh bread is
 * here", "Finally at the market"), the offering's name standing as the
 * whole headline, and a subheadline that says the headline again ("Repairs
 * in a day" over "we repair your phone in one day").
 *
 * A proxy, not a judgement of the hook: a headline can avoid all three and
 * still be flat, which the judge measures. What this catches it catches
 * for free, so the planner asks for a new hook before anything is drawn.
 * Not a contract rule: a flat hook is drawable.
 */

const ANNOUNCEMENT =
  /\b(?:is|are|'s)\s+(?:here|back|live|now available|available now)\b[.!]?\s*$|^\s*(?:introducing|meet|presenting|announcing|new|now)\b|\b(?:arrived|arrives|landed|lands|dropped)\b|\bjust\s+in\b|\bnew\s+(?:in|arrival|arrivals|stock)\b|\bnow\s+(?:available|open|in stock)\b|\b(?:out now|in stores?|back in stock)\b|\bfinally\b/i;

const DEVICE = /^\s*before\b[^.!?]*[.:!?—–-]\s*after\b/i;

/* An arrival said outright reads as a label however concrete the words
   around it ("Hand-woven baskets from Bida are here"). */
const ARRIVAL =
  /\b(?:is|are|'s)\s+(?:here|back)\b|\b(?:has|have)\s+arrived\b|\bfinally\b/i;

const ARRIVAL_WORDS =
  /\s*\b(?:(?:is|are)\s+(?:here|back)(?:\s+in\s+stock)?|'s\s+(?:here|back)|(?:has|have)\s+(?:arrived|landed)|finally)\b/gi;

/* Content words a hook's point keeps beyond the names once its arrival is
   taken out, for the rest to stand as a reason of its own. */
const REASON_WORDS = 3;

/**
 * A hook's point with its arrival taken out ("Ata Kitchen's sauce is
 * back, made in small batches" is "Ata Kitchen's sauce, made in small
 * batches"): the news is a label, and a hook written to a point that says
 * it leads on it. The point as it was when nothing would be left but the
 * name.
 */
export function withoutArrival(
  point: string,
  free: ReadonlySet<string> = new Set(),
): string {
  if (!ARRIVAL.test(point)) return point;
  const cut = point
    .replace(ARRIVAL_WORDS, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])\s*(?=[,.;:!?]|$)/g, "")
    .replace(/^[\s,;:—–-]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return contentStems(cut, free).size >= REASON_WORDS ? cut : point;
}

/* What a strong hook does instead: a question any competitor could ask
   ("Still doing laundry yourself?") or a mood line reads as generic; the
   brief's own specific (a duration, a count, who makes it) does not. */
export const HOOK_CRAFT =
  "build the headline on the most concrete thing the brief gives (a figure, how it is made, who makes it, what it changes for the reader), said straight (a question or a before-and-after only when the figure is in it), and name the offering in the headline or the subheadline";

/* Content words a headline and its subheadline may share before the second
   line reads as the first said again; the brand's name is free. Two is
   already an echo a reader hears ("Whiter teeth" over "teeth whitening"). */
const ECHO_WORDS = 2;

/* The offering's own name said in full under a headline that gives part
   of it ("Pastry masterclass" over "The weekend French pastry masterclass") is
   the hook naming what is on offer, not an echo. */
function echoedWords(
  hook: Pick<FrameBeat, "headline" | "subheadline">,
  brandName: string,
  offering: string | null = null,
): string[] {
  const free = new Set([
    ...contentStems(brandName),
    ...contentStems(offering ?? ""),
  ]);
  const headline = contentStems(hook.headline, free);
  return [...contentStems(hook.subheadline, free)].filter((s) =>
    headline.has(s),
  );
}

/** Whether the hook's subheadline says its headline again. */
export function echoesHeadline(
  hook: Pick<FrameBeat, "headline" | "subheadline">,
  brandName: string,
  offering: string | null = null,
): boolean {
  return echoedWords(hook, brandName, offering).length >= ECHO_WORDS;
}

/* Content words the hook may share with a later frame before it reads as
   spending that frame's point before the swipe. Tighter than two body
   frames are held to (repeats.ts): "Straight from Kumasi" on the hook
   and "directly from Kumasi" on frame 2 read as one point made twice. */
const HOOK_PREVIEW_WORDS = 2;

/** Zero-based indexes of the later frames whose point the hook already
 *  spends, by the content words they share beyond the brand's and the
 *  offering's names. `actionFree` holds the words the last frame may say
 *  again whatever the hook said: what the reader needs to act (a price, a
 *  date, a place, a contact, the ask), which is the action's to give and
 *  no repeat of the hook. */
export function previewedFrames(
  frames: readonly FrameBeat[],
  offering: string | null,
  brandName = "",
  actionFree: ReadonlySet<string> = new Set(),
): number[] {
  const [hook, ...later] = frames;
  if (!hook) return [];
  const free = namesFree(brandName, offering);
  /* The hook must name the offering, so the offering's words are never
     the point it spends: "scotch bonnet pepper sauce" on the hook does not
     preview "About 30 scotch bonnets in every jar". */
  const hookWords = contentStems(
    `${hook.headline} ${hook.subheadline}`,
    new Set([...free, ...contentStems(offering ?? "")]),
  );
  const lastIndex = later.length - 1;
  return later.flatMap((beat, i) => {
    /* The later frame restating the hook's headline is that frame's
       headline-repeat (validateSequence), not the hook's fault. */
    if (isNearDuplicateHeadline(hook.headline, beat.headline, free)) return [];
    const shared = [
      ...contentStems(`${beat.headline} ${beat.subheadline}`, free),
    ].filter(
      (s) => hookWords.has(s) && !(i === lastIndex && actionFree.has(s)),
    );
    return shared.length >= HOOK_PREVIEW_WORDS ? [i + 1] : [];
  });
}

/** The hook's faults for the later frames it previews. */
export function hookPreviews(
  frames: readonly FrameBeat[],
  offering: string | null,
  brandName = "",
  actionFree: ReadonlySet<string> = new Set(),
): string[] {
  return previewedFrames(frames, offering, brandName, actionFree).map(
    (i) =>
      `the hook already says what frame ${i + 1} ("${frames[i].headline}") is for; leave that point to it and give the hook its own reason to swipe`,
  );
}

/* An offering read as a name ("flat white", "Paybook") may be said on any
   frame; one read as a description ("Book a cleaner in pounds or euros in
   two taps") is made of points, and a frame that says them again repeats
   them, so "pounds or euros" on two frames still counts. */
const NAME_STEMS = 3;

/** Stems any frame may say without repeating a point: the brand's name and
 *  the offering's, when the offering reads as a name. */
export function namesFree(
  brandName: string,
  offering: string | null,
): Set<string> {
  const offered = contentStems(offering ?? "");
  return new Set([
    ...contentStems(brandName),
    ...(offered.size <= NAME_STEMS ? offered : []),
  ]);
}

/** The names in `names` the hook leaves out, beyond the offering (which
 *  is validateSequence's offering-unnamed). */
export function unnamedOnHook(
  hook: FrameBeat,
  offering: string | null,
  names: readonly string[],
): string[] {
  return names.filter(
    (name) => name !== offering && !copyNamesOffering(hook, name),
  );
}

const CONCRETE_WORDS = 3;

/* Words an announcement is made of: news carried beside a concrete
   reason ("Back in stock: real Oyo heat") still gives the reader one. */
const NEWS_WORDS = new Set(
  [
    "here",
    "back",
    "live",
    "available",
    "introducing",
    "meet",
    "presenting",
    "announcing",
    "arrived",
    "landed",
    "dropped",
    "stock",
    "finally",
    "launch",
    "launches",
    "store",
  ].flatMap((w) => [...contentStems(w)]),
);

/** Whether a headline says something concrete beyond the names, where to
 *  find it and the news: a figure, or three words of its own. */
function concreteBeyond(
  headline: string,
  labelWords: ReadonlySet<string>,
): boolean {
  if (/\d/.test(headline)) return true;
  const own = [...contentStems(headline)].filter(
    (s) => !labelWords.has(s) && !NEWS_WORDS.has(s),
  );
  return own.length >= CONCRETE_WORDS;
}

const WEEKDAY_OR_MONTH =
  /^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*$|^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*$/;

/* A reader's reason needs a subject acting on them ("We wash your car
   while you work") or a question put to them; without either, a single
   word beside the names is a status ("restocked", "just landed", "now
   open"), whatever the word. */
const ADDRESSES_READER = /\b(?:you|your|yours|we|our|us)\b/i;

/**
 * A headline that is a label: past the offering's and brand's names, the
 * places and the schedule (days, months, the brief's dates and times), it
 * keeps at most one word of its own and no figure, and speaks to no one.
 * A rule on what is left, not a list of announcement words, so "Pepper
 * sauce, restocked" and "Laundry pickup: Monday to Wednesday" read as the
 * labels they are while "We wash your car while you work" does not.
 */
export function isLabelHeadline(
  headline: string,
  labelWords: ReadonlySet<string>,
  facts: readonly BriefFact[] = [],
): boolean {
  if (
    /\p{N}/u.test(headline) ||
    ADDRESSES_READER.test(headline) ||
    /\?\s*$/.test(headline)
  ) {
    return false;
  }
  const schedule = new Set(
    facts
      .filter((f) => f.kind === "date" || f.kind === "time" || f.kind === "day")
      .flatMap((f) => [...contentStems(f.text)]),
  );
  const own = [...contentStems(headline)].filter(
    (s) => !labelWords.has(s) && !schedule.has(s) && !WEEKDAY_OR_MONTH.test(s),
  );
  return own.length <= 1;
}

/** `names`: what else the hook must name beyond the offering (the brand,
 *  when the brief makes it the subject: hookNames in the prompt). The
 *  offering itself is validateSequence's offering-unnamed. */
export function hookFaults(
  hook: FrameBeat,
  offering: string | null,
  names: readonly string[] = [],
  brandName = "",
  facts: readonly BriefFact[] = [],
): string[] {
  const faults = unnamedOnHook(hook, offering, names).map(
    (name) =>
      `the hook does not name "${name}"; put it in the subheadline in these words`,
  );
  const named = contentStems(offering ?? "");
  /* The name and where to find it is still a label ("Cold brew at our
     Yaba bar" is housekeeping, not a reason to swipe). */
  const labelWords = new Set([
    ...named,
    ...contentStems(brandName),
    ...facts
      .filter((f) => f.kind === "place")
      .flatMap((f) => [...contentStems(f.text)]),
  ]);
  const said = contentStems(hook.headline);
  const nameAlone =
    named.size > 0 &&
    [...said].some((s) => named.has(s)) &&
    [...said].every((s) => labelWords.has(s));
  if (
    ARRIVAL.test(hook.headline) ||
    (ANNOUNCEMENT.test(hook.headline) &&
      !concreteBeyond(hook.headline, labelWords))
  ) {
    faults.push(
      `the hook's headline "${hook.headline}" announces the offering, which gives no reason to swipe; ${HOOK_CRAFT}`,
    );
  } else if (nameAlone) {
    faults.push(
      `the hook's headline "${hook.headline}" is only the name of what is offered; ${HOOK_CRAFT}`,
    );
  } else if (isLabelHeadline(hook.headline, labelWords, facts)) {
    faults.push(
      `the hook's headline "${hook.headline}" is a label: past the names, the place and the schedule it gives no reason to swipe; ${HOOK_CRAFT}`,
    );
  }
  if (!hook.subheadline.trim()) {
    faults.push(
      "the hook has a headline and nothing under it; the subheadline is one whole sentence on what the reader gets because of the headline's claim, naming the offering if the headline does not",
    );
  }
  /* A before-and-after with no figure in it is a device any competitor
     could post ("Before: no sauce. After: Oyo fire."): it is only worth
     its line when it holds the brief's own number. */
  if (!/\p{N}/u.test(hook.headline) && DEVICE.test(hook.headline)) {
    faults.push(
      `the hook's headline "${hook.headline}" is a before-and-after with no figure in it, a device any competitor could post; ${HOOK_CRAFT}`,
    );
  }
  /* The name with where to find it under a headline is a label left
     behind, not the reader's stake. */
  const subWords = [...contentStems(hook.subheadline)].filter(
    (s) => !labelWords.has(s),
  );
  if (hook.subheadline.trim() && subWords.length === 0) {
    faults.push(
      `the hook's subheadline "${hook.subheadline}" only names the offering and where it is; say what the reader gets because of the headline's claim`,
    );
  }
  /* An announcement under a question ("— just arrived") is a flat retail
     cliché: the second line spends the pull the first one made. */
  if (ANNOUNCEMENT.test(hook.subheadline)) {
    faults.push(
      `the hook's subheadline "${hook.subheadline}" announces the offering; name it with the one specific from the brief that makes the headline's pull concrete`,
    );
  }
  if (echoesHeadline(hook, brandName, offering)) {
    faults.push(
      `the hook's subheadline "${hook.subheadline}" says what its headline says; the subheadline names the offering and adds what the headline does not`,
    );
  }
  return faults;
}
