import {
  aboveRepeatsBy,
  type BriefFact,
  factStated,
  isFragment,
} from "@/lib/jobs/directions/brief-facts";
import type { FactLedger } from "@/lib/jobs/directions/claims";
import { contentStems } from "@/lib/jobs/directions/text-overlap";
import { textsOverlap } from "./arc";
import type { FrameBeat, PlannedSequence, SequenceKind } from "./contract";
import { hookFaults, hookPreviews, namesFree } from "./hook";
import { inventedOn } from "./ledger";
import { ownerPointKept } from "./outline-arc";
import { factOnlyFrames, misplacedPrices, statesPrice } from "./points";
import { releasedFaults, removedFaults } from "./removed";
import { sequenceRepeats } from "./repeats";
import { titleProblems } from "./title";
import { frameCopy, isWordBudgetProblem, validateSequence } from "./validate";

/**
 * Everything code finds wrong with a written set, by frame and field, with
 * a weight: what the fix call is asked to rewrite and what a rewrite is
 * scored on. A fault in a headline, a title or a subheadline that is not
 * a sentence is what a reader sees first, so it weighs as much as a
 * broken rule; a phrase said twice in small print weighs least.
 */

export type FaultField =
  | "headline"
  | "subheadline"
  | "footer"
  | "title"
  | "cta"
  | "frame";

export interface CopyFault {
  frame: number;
  field: FaultField;
  detail: string;
  weight: number;
  /** A fault against what the set may say at all, not how well it says
   *  it: a claim no source gives, a point or fact the owner took out, the
   *  owner's own point turned into another. Never shipped (breaches). */
  breach?: true;
}

/* A fault a reader sees at once, or one that loses the frame. */
export const MAJOR = 3;
/* A brief fact no frame states, or a hook that does not say what is on
   offer, fails the set's coverage (H5): never the price of another fix. */
export const COVERAGE = 2 * MAJOR;
const MINOR = 1;

export interface FaultRules {
  frameCount: number;
  facts: readonly BriefFact[];
  offering: string | null;
  hasImage: boolean;
  brandName: string;
  /** What the hook must name (hookNames). */
  names: readonly string[];
  ledger: FactLedger;
  /** Zero-based fact indexes each frame was planned to state, so a fact
   *  no frame states is asked of the frame meant to carry it. */
  owners?: readonly (readonly number[])[];
  /** Each frame's claim from the arc, by index ("" for none), so copy that
   *  strays into another frame's claim is found. */
  claims?: readonly string[];
  /** The brief's and the profile's words, which a title cut from them is
   *  read against (titleProblems). */
  titleSources?: readonly string[];
  /** What the audit call read in the written set (flaggedFaults). */
  flagged?: readonly Flag[];
  /** Prices the action frame states (actionPrices). */
  atAction?: ReadonlySet<number>;
  /** By frame, the owner's own words from the approved outline, or "":
   *  copy may shorten them, never change the claim (O5). */
  owned?: readonly string[];
  /** Points the owner took out of the approved outline (removedPoints):
   *  no frame may make one (O5). */
  removed?: readonly string[];
  /** Brief facts the owner took out of the approved outline
   *  (releasedFacts): no frame need state one, and none may. */
  released?: readonly string[];
  /** The brief, whose own sentences the ship gate may set under a bare
   *  headline: words no reader can call invented. */
  briefText?: string;
}

/** One finding of the audit call, held to the copy it was made on. */
export type Flag =
  | {
      kind: "repeat";
      /** Zero-based: the later frame, and the earlier one whose point it
       *  makes. */
      frame: number;
      sameAs: number;
      /** The later frame's headline when it was read: a rewrite of the
       *  frame is a new reading, which the call never saw. */
      headline: string;
    }
  | { kind: "unsourced"; frame: number; text: string };

const flatten = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/* Share of a flagged statement's content words still on its frame past
   which the frame still says it. */
const STILL_SAID = 0.75;

/** Whether `frame` still says the statement `text`: its words, or most of
 *  its content words. */
export function stillSays(
  beat: Pick<FrameBeat, "headline" | "subheadline" | "footerLines">,
  text: string,
): boolean {
  const copy = [beat.headline, beat.subheadline, ...beat.footerLines].join(" ");
  if (flatten(copy).includes(flatten(text))) return true;
  const wanted = [...contentStems(text)];
  if (wanted.length < 2) return false;
  const said = contentStems(copy);
  return wanted.filter((s) => said.has(s)).length / wanted.length >= STILL_SAID;
}

/** The audit's findings that still stand on the set as it is now: a
 *  repeat until the later frame is rewritten, an unsourced statement until
 *  its words are gone. */
export function flaggedFaults(
  frames: readonly FrameBeat[],
  flagged: readonly Flag[],
): CopyFault[] {
  return flagged.flatMap((flag): CopyFault[] => {
    const beat = frames[flag.frame];
    if (!beat) return [];
    if (flag.kind === "unsourced") {
      return stillSays(beat, flag.text)
        ? [
            {
              frame: flag.frame,
              field: "frame",
              detail: `it states "${flag.text}", which neither the brief nor the brand profile gives; leave it out`,
              weight: MAJOR,
            },
          ]
        : [];
    }
    const earlier = frames[flag.sameAs];
    if (!earlier || beat.headline !== flag.headline) return [];
    return [
      {
        frame: flag.frame,
        field: "headline",
        detail:
          beat.role === "cta"
            ? `it says what frame ${flag.sameAs + 1} ("${earlier.headline}") already says; the last frame gives what acting gets the reader, in words no earlier frame used`
            : `it makes frame ${flag.sameAs + 1}'s point ("${earlier.headline}") again in other words; this frame says only its own claim`,
        weight: MAJOR,
      },
    ];
  });
}

/* Copy that talks about the piece rather than what it is about: "This
   investor deck covers the round". */
const ABOUT_ITSELF =
  /\b(?:this|our|these|the next|the following)\s+(?:[\p{L}-]+\s+)?(?:deck|carousel|presentation|slides?|frames?)\b|\b(?:fundraising|pitch|investor|sales|funding)\s+(?:deck|presentation|carousel)\b/iu;

/** A hook that gives how to act (a contact): the first frame spends its
 *  one line on what the last frame is for, and gives no reason to swipe. */
export function contactOnHook(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
): CopyFault[] {
  const hook = frames[0];
  if (!hook || frames.length < 2) return [];
  return (["headline", "subheadline"] as const).flatMap((field) =>
    facts
      .filter((f) => f.kind === "contact" && factStated(f, hook[field]))
      .map((f) => ({
        frame: 0,
        field,
        detail: `the hook's ${field} gives the contact "${f.text}", which belongs on the last frame; give the reader a reason to swipe instead`,
        weight: MAJOR,
      })),
  );
}

/** Fields that speak of the set itself instead of the offering. */
export function selfReferences(frames: readonly FrameBeat[]): CopyFault[] {
  return frames.flatMap((beat, frame) =>
    (["headline", "subheadline"] as const).flatMap((field) => {
      const found = ABOUT_ITSELF.exec(beat[field]);
      return found
        ? [
            {
              frame,
              field,
              detail: `its ${field} talks about the set itself ("${found[0]}"); say what the offering is or does instead`,
              weight: MAJOR,
            },
          ]
        : [];
    }),
  );
}

/* A line that ends on a verb or a preposition still waiting for its
   object was cut, not written: "Ironclad Gym's monthly membership
   includes". */
const CUT_ON_VERB =
  /\b(?:includes?|including|offers?|features?|provides?|covers?|brings?|gives?|means?|lets?|helps?|with|without|plus|like|such as|including)[.!]?$/i;

const SUBJECTLESS =
  /^(?:is|are|was|were|has|have|had|will|would|can|could|does|do|did|gets?|makes?|means?|keeps?|comes?|goes?)\b/i;

/** Why a subheadline does not read as a sentence of its own, or null: it
 *  starts mid-sentence, opens on a verb with no subject, or is a cut-off
 *  phrase. Edited and split fields are where these come from ("10 vans"
 *  over "is fully allocated to expanding cold-chain coverage."). */
export function subheadlineGrammar(subheadline: string): string | null {
  const text = subheadline.trim();
  if (!text) return null;
  if (CUT_ON_VERB.test(text)) {
    return `the subheadline "${text}" stops before what it names; write it as a whole sentence`;
  }
  if (/^\p{Ll}/u.test(text)) {
    return `the subheadline "${text}" starts mid-sentence; write it as a whole sentence that starts with a capital and names its own subject`;
  }
  if (SUBJECTLESS.test(text)) {
    return `the subheadline "${text}" has no subject; write it as a whole sentence that names what it is about`;
  }
  if (isFragment(text)) {
    return `the subheadline "${text}" is a fragment; write it as a whole sentence, or leave it empty`;
  }
  return null;
}

/* A headline that opens on one of these and runs four words or fewer is a
   signpost hung off the frame before it ("for Year 6 pupils"), not a line
   that says something. */
const SIGNPOST_OPENERS =
  /^(?:for|with|to|from|at|in|on|by|about|of|and|or|but)\b/i;
const SIGNPOST_WORDS = 4;

/** Why a headline does not stand as a line of its own, or null: it starts
 *  lowercase, or it is a short phrase opening on a preposition or a
 *  conjunction. */
export function headlineGrammar(headline: string): string | null {
  const text = headline.trim();
  if (!text) return null;
  if (CUT_ON_VERB.test(text)) {
    return `the headline "${text}" stops before what it names; write a line that says it whole`;
  }
  if (/^\p{Ll}/u.test(text)) {
    return `the headline "${text}" starts lowercase, as if it continued another frame; write it as a line that stands on its own`;
  }
  const words = text.split(/\s+/).filter(Boolean).length;
  if (SIGNPOST_OPENERS.test(text) && words <= SIGNPOST_WORDS) {
    return `the headline "${text}" is a fragment with no subject; say what this frame's claim tells the reader`;
  }
  return null;
}

/** Frames whose card title is not a clean, whole, distinct name for its
 *  own copy (titleProblems). */
export function titleFaults(
  frames: readonly FrameBeat[],
  sources: readonly string[],
): CopyFault[] {
  return titleProblems(frames, { sources }).map(({ frame, detail }) => ({
    frame,
    field: "title" as const,
    detail: `${detail}; give this frame a title of 2 to 4 words that names its own point`,
    weight: MAJOR,
  }));
}

/**
 * Frames whose headline makes an earlier frame's point: half of its
 * content words, or three of them, are already in that frame's headline
 * and subheadline, beyond the names every frame may say and the brief's
 * logistics. Two cards under two names carrying one idea is the repeat a
 * near-duplicate check of headlines alone lets through.
 */
export function pointRepeats(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
  free: ReadonlySet<string>,
): CopyFault[] {
  const ignore = new Set([
    ...free,
    ...facts.flatMap((f) => [...contentStems(f.text)]),
  ]);
  return frames.flatMap((beat, j) => {
    if (beat.role === "cta") return [];
    const i = frames.findIndex(
      (earlier, k) =>
        k < j &&
        textsOverlap(
          beat.headline,
          `${earlier.headline} ${earlier.subheadline}`,
          ignore,
        ),
    );
    return i < 0
      ? []
      : [
          {
            frame: j,
            field: "headline" as const,
            detail: `its headline "${beat.headline}" makes frame ${i + 1}'s point ("${frames[i].headline}") again; this frame says only its own claim`,
            weight: MAJOR,
          },
        ];
  });
}

/* Content words of another frame's claim, beyond the frame's own claim,
   past which its copy is making that frame's point. */
const STRAY_WORDS = 2;

/**
 * Frames whose copy strays into another frame's claim: the copy of each
 * frame may state only its own (the arc), so a headline and subheadline
 * that use two or more of another claim's own words, which their own
 * claim does not hold, are writing that frame's point.
 */
export function claimStrays(
  frames: readonly FrameBeat[],
  claims: readonly string[],
  ignore: ReadonlySet<string>,
): CopyFault[] {
  return frames.flatMap((beat, j) => {
    if (beat.role === "cta") return [];
    const own = contentStems(claims[j] ?? "", ignore);
    const said = [
      ...contentStems(`${beat.headline} ${beat.subheadline}`, ignore),
    ].filter((s) => !own.has(s));
    const i = claims.findIndex((claim, k) => {
      if (k === j || !claim || frames[k]?.role === "cta") return false;
      const theirs = contentStems(claim, ignore);
      return said.filter((s) => theirs.has(s)).length >= STRAY_WORDS;
    });
    return i < 0
      ? []
      : [
          {
            frame: j,
            field: "frame" as const,
            detail: `it strays into frame ${i + 1}'s claim ("${claims[i]}"); say only this frame's own claim${claims[j] ? ` ("${claims[j]}")` : ""}`,
            weight: MAJOR,
          },
        ];
  });
}

/** A price the action frame states (a carousel's every price, a deck's
 *  ask: actionPrices) in a headline before it: the hook or a body frame
 *  that leads on the figure the reader meets at the end. */
export function headlinePrices(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
  kind: SequenceKind,
  atAction: ReadonlySet<number> = new Set(),
): CopyFault[] {
  const last = frames.length;
  const priced = facts.filter(
    (f, n) => f.kind === "price" && (kind === "carousel" || atAction.has(n)),
  );
  return frames.flatMap((beat, frame) =>
    beat.role === "cta"
      ? []
      : priced
          .filter((f) =>
            statesPrice(f, { ...beat, subheadline: "", footerLines: [] }),
          )
          .map((price) => ({
            frame,
            field: "headline" as const,
            detail: `its headline gives the price "${price.text}", which belongs on frame ${last} beside the action; leave the price out of this frame`,
            weight: MAJOR,
          })),
  );
}

const FIELD_OF: [RegExp, FaultField][] = [
  [/\bsubheadline\b/, "subheadline"],
  [/\bheadline\b/, "headline"],
  [/\btitle\b/, "title"],
  [/\bbutton\b/, "cta"],
  [/\bfooter\b/, "footer"],
];

const fieldIn = (detail: string): FaultField =>
  FIELD_OF.find(([pattern]) => pattern.test(detail))?.[1] ?? "frame";

/** The contract rules a written set breaks, as faults: coverage weighs
 *  most, a headline a word over its budget least. Layouts, roles and the
 *  hook's image are settled in code before copy, so they are not asked
 *  of a rewrite. */
function ruleFaults(plan: PlannedSequence, rules: FaultRules): CopyFault[] {
  const last = plan.frames.length - 1;
  const ownerOf = (text: string) => {
    const n = rules.facts.findIndex((f) => text.includes(`"${f.text}"`));
    const owner = (rules.owners ?? []).findIndex((owned) => owned.includes(n));
    return owner >= 0 ? owner : last;
  };
  return validateSequence(plan, rules).flatMap((p): CopyFault[] => {
    switch (p.rule) {
      case "fact-uncovered":
        return [
          {
            frame: ownerOf(p.detail),
            field: "frame",
            detail: p.detail,
            weight: COVERAGE,
          },
        ];
      case "offering-unnamed":
        return [
          { frame: 0, field: "headline", detail: p.detail, weight: COVERAGE },
        ];
      case "headline-repeat":
        return [
          {
            frame: p.frame ?? 0,
            field: "headline",
            detail: p.detail,
            weight: MAJOR,
          },
        ];
      case "copy-length":
        return [
          {
            frame: p.frame ?? 0,
            field: fieldIn(p.detail),
            detail: p.detail,
            weight: isWordBudgetProblem(p) ? MINOR : MAJOR,
          },
        ];
      case "cta-last":
        return [{ frame: last, field: "cta", detail: p.detail, weight: MAJOR }];
      default:
        return [];
    }
  });
}

/* Hook faults a reader sees before anything else: an announcement, the
   offering's name standing alone, a name it must carry and leaves out, a
   second line that only says the first again. */
const FLAT_HOOK =
  /announces the offering|only the name|does not name|says what its headline says|a device any competitor|only names the offering and where/;

/** Every fault of a written set (see the module comment). */
export function setFaults(
  plan: PlannedSequence,
  rules: FaultRules,
): CopyFault[] {
  const { frames, kind } = plan;
  const { facts, offering, brandName, names } = rules;
  const free = namesFree(brandName, offering);
  const minor = (r: { frame: number; detail: string }): CopyFault => ({
    frame: r.frame,
    field: fieldIn(r.detail),
    detail: r.detail,
    weight: MINOR,
  });
  const hook = frames[0];
  return [
    ...ruleFaults(plan, rules),
    ...frames.flatMap((beat, frame) =>
      inventedOn(beat, rules.ledger).map((made) => ({
        frame,
        field: "frame" as const,
        detail: `it states "${made}", which neither the brief nor the brand profile gives; leave it out`,
        weight: MAJOR,
        breach: true as const,
      })),
    ),
    ...frames.flatMap((beat, frame) => {
      const fault = subheadlineGrammar(beat.subheadline);
      return fault
        ? [
            {
              frame,
              field: "subheadline" as const,
              detail: fault,
              weight: MAJOR,
            },
          ]
        : [];
    }),
    ...frames.flatMap((beat, frame) => {
      const fault = headlineGrammar(beat.headline);
      return fault
        ? [{ frame, field: "headline" as const, detail: fault, weight: MAJOR }]
        : [];
    }),
    ...titleFaults(frames, rules.titleSources ?? []),
    ...flaggedFaults(frames, rules.flagged ?? []),
    ...selfReferences(frames),
    ...contactOnHook(frames, facts),
    ...pointRepeats(frames, facts, free),
    ...claimStrays(frames, rules.claims ?? [], logisticsFree(free, facts)),
    ...headlinePrices(frames, facts, kind, rules.atAction),
    ...(hook
      ? hookFaults(hook, offering, names, brandName, facts).map((detail) => ({
          frame: 0,
          field: detail.startsWith("the hook's subheadline")
            ? ("subheadline" as const)
            : ("headline" as const),
          detail,
          weight: FLAT_HOOK.test(detail) ? MAJOR : MINOR,
        }))
      : []),
    ...hookPreviews(
      frames,
      offering,
      brandName,
      actionWords(free, facts, rules.atAction),
    ).map((detail) =>
      recapsTheHook(detail, frames.length)
        ? {
            frame: frames.length - 1,
            field: "headline" as const,
            detail: `it says again what the hook says ("${frames[0]?.headline ?? ""}"); the last frame gives how to act, in words no earlier frame used`,
            weight: MAJOR,
          }
        : {
            frame: 0,
            field: "subheadline" as const,
            detail,
            weight: MAJOR,
          },
    ),
    ...bareFrames(frames),
    ...bareNameSubheadlines(frames, free),
    ...restatedSubheadlines(frames),
    ...[
      ...ownerPointsChanged(frames, rules.owned ?? [], free),
      ...removedFaults(
        frames,
        rules.removed ?? [],
        rules.claims ?? [],
        logisticsFree(free, facts),
      ),
      ...releasedFaults(
        frames,
        rules.facts,
        rules.released ?? [],
        rules.owned ?? [],
      ),
    ].map((f) => ({ ...f, breach: true as const })),
    ...sequenceRepeats(frames, facts, offering, brandName).map(minor),
    ...factOnlyFrames(frames, facts).map(minor),
    /* A price dropped mid-story has no job there and reads as the close
       come early; only the owner's own point may carry one. */
    ...misplacedPrices(frames, facts, kind).map((r) =>
      ownerGivesPrice(rules.owned?.[r.frame] ?? "", facts)
        ? minor(r)
        : { ...minor(r), weight: MAJOR },
    ),
  ];
}

const ownerGivesPrice = (owned: string, facts: readonly BriefFact[]) =>
  owned.trim() !== "" &&
  facts.some((f) => f.kind === "price" && factStated(f, owned));

/* Words any frame may say: the names, and the brief's logistics, which the
   action frame and its neighbours can both mention. */
export function logisticsFree(
  free: ReadonlySet<string>,
  facts: readonly BriefFact[],
): Set<string> {
  return new Set([
    ...free,
    ...facts
      .filter((f) =>
        [
          "date",
          "day",
          "time",
          "place",
          "contact",
          "product",
          "price",
        ].includes(f.kind),
      )
      .flatMap((f) => [...contentStems(f.text)]),
  ]);
}

/** Words the action frame may say again after the hook: the logistics
 *  (logisticsFree) and the facts the action carries (actionPrices: a
 *  carousel's price, a deck's ask). Restating how to act is not a
 *  repeat. */
export function actionWords(
  free: ReadonlySet<string>,
  facts: readonly BriefFact[],
  atAction: ReadonlySet<number> = new Set(),
): Set<string> {
  return new Set([
    ...logisticsFree(free, facts),
    ...facts
      .filter((_, n) => atAction.has(n))
      .flatMap((f) => [...contentStems(f.text)]),
  ]);
}

/* A close that restates the opening reads as the set circling back: the
   last frame is rewritten, never the hook that earned the swipe. */
const recapsTheHook = (detail: string, count: number) =>
  detail.includes(`what frame ${count} (`);

/** Frames whose subheadline gives only names ("FreshFold.", "Fixit
 *  Hub.", "Alterations from Stitchwell."): a label left under a headline,
 *  which says nothing a reader did not already have. */
export function bareNameSubheadlines(
  frames: readonly FrameBeat[],
  free: ReadonlySet<string>,
): CopyFault[] {
  return frames.flatMap((beat, frame) => {
    const text = beat.subheadline.trim();
    if (!text || /\p{N}/u.test(text)) return [];
    if (contentStems(text, free).size > 0) return [];
    return [
      {
        frame,
        field: "subheadline" as const,
        detail: `the subheadline "${text}" gives only a name; write one sentence that says something about this frame's claim, or leave it empty`,
        weight: MAJOR,
      },
    ];
  });
}

/** Middle frames with a headline and nothing under it: read in order, a
 *  bare line lands as an unfinished thought between two frames that say
 *  more, so it must not ship. */
export function bareFrames(frames: readonly FrameBeat[]): CopyFault[] {
  return frames.flatMap((beat, frame) =>
    beat.role === "body" && !beat.subheadline.trim()
      ? [
          {
            frame,
            field: "subheadline" as const,
            detail:
              "it has a headline and nothing under it; add one sentence with a concrete detail of this frame's claim that the headline leaves out, or, where the brief and profile give none, what the claim plainly means for the reader, adding no fact",
            weight: MAJOR,
          },
        ]
      : [],
  );
}

/** Whether a middle frame's subheadline only says its headline again
 *  (aboveRepeatsBy): read in order, the frame makes one point twice. */
export function restatesHeadline(beat: FrameBeat): boolean {
  return (
    beat.role === "body" &&
    aboveRepeatsBy(frameCopy(beat)).some((r) => r.field === "headline")
  );
}

/** Middle frames whose subheadline restates their headline. Blocking: a
 *  slide that says its point twice is what a reader marks as repetition. */
export function restatedSubheadlines(
  frames: readonly FrameBeat[],
): CopyFault[] {
  return frames.flatMap((beat, frame) =>
    restatesHeadline(beat)
      ? [
          {
            frame,
            field: "subheadline" as const,
            detail:
              "its subheadline says its headline again; write one sentence with a detail of this frame's claim that the headline leaves out",
            weight: MAJOR,
          },
        ]
      : [],
  );
}

/** Frames whose copy turned the owner's point into another claim
 *  (ownerPointKept). `owned` holds, by frame, the owner's words, or "". */
export function ownerPointsChanged(
  frames: readonly FrameBeat[],
  owned: readonly string[],
  free: ReadonlySet<string>,
): CopyFault[] {
  return frames.flatMap((beat, frame) => {
    const point = owned[frame]?.trim();
    if (!point || ownerPointKept(beat, point, free)) return [];
    return [
      {
        frame,
        field: "frame" as const,
        detail: `it no longer says the owner's point ("${point}"); keep what it claims and its figures, shortened if it must be`,
        weight: MAJOR,
      },
    ];
  });
}

/** How far a set is from shipping clean: 0 is no fault. */
export function faultScore(faults: readonly CopyFault[]): number {
  return faults.reduce((n, f) => n + f.weight, 0);
}

/** The faults that must not ship: in a headline or a title, a subheadline
 *  that is not a sentence, and anything weighing as much as a broken
 *  rule. */
export function blockingFaults(faults: readonly CopyFault[]): CopyFault[] {
  return faults.filter((f) => f.weight >= MAJOR);
}

/** The faults no set ships with (CopyFault.breach). */
export function breaches(faults: readonly CopyFault[]): CopyFault[] {
  return faults.filter((f) => f.breach === true);
}

/** How a version of the hook stands beside the set, lower first: the
 *  faults it leaves on frame 1, coverage of the offering weighing most. */
export function hookScore(
  hook: FrameBeat,
  plan: PlannedSequence,
  rules: FaultRules,
): number {
  const frames = plan.frames.map((beat, i) => (i === 0 ? hook : beat));
  return faultScore(
    setFaults({ ...plan, frames }, rules).filter((f) => f.frame === 0),
  );
}
