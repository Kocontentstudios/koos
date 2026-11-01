import type { BriefFact } from "@/lib/jobs/directions/brief-facts";
import { contentStems } from "@/lib/jobs/directions/text-overlap";
import { textsOverlap } from "./arc";
import { upperFirst } from "./casing";
import type { FrameBeat, PlannedSequence } from "./contract";
import {
  blockingFaults,
  breaches,
  COVERAGE,
  type CopyFault,
  type FaultRules,
  faultScore,
  MAJOR,
  setFaults,
} from "./faults";
import { asSentence, claimHalves, fitsHeadline, fitsSubheadline } from "./gate";
import { namesFree } from "./hook";
import { unsayable, withoutFactText } from "./removed";

/**
 * The last step before a set ships: every frame still carrying a fault
 * that must not ship (blockingFaults) is rewritten in code from its own
 * point, the approved outline's words, which no reader can call invented
 * and no other frame was written from. Each candidate is kept only where
 * the whole set ends with fewer blocking faults, so a rewrite never moves
 * a fault from one frame to another. What still blocks after it is
 * returned for the caller to refuse the set on.
 */

export interface LastResortResult {
  plan: PlannedSequence;
  /** "frame k: how it was rewritten", in order. */
  applied: string[];
  /** Blocking faults left, breaches among them. */
  blocking: CopyFault[];
  /** Breaches left after every cut: the set must not ship with any. */
  breaches: CopyFault[];
}

/* Two passes: a frame rewritten in the first can clear a repeat that kept
   a later frame's own rewrite from helping. */
const PASSES = 2;

const blockingScore = (plan: PlannedSequence, rules: FaultRules) =>
  faultScore(blockingFaults(setFaults(plan, rules)));

/* "Each bottle is 350ml and keeps for 5 days" divides into a headline and
   "keeps for 5 days", which has no subject: the second half's subject is
   the first half's, said as "it" or "they". */
const SUBJECTLESS_VERB =
  /^(?:is|are|was|were|has|have|had|keeps?|comes?|gets?|takes?|makes?|runs?|lasts?|means?|goes?|works?|holds?|costs?|gives?)\b/i;

/* The gate splits a claim only where its head carries a verb and an
   object; as a last resort a head of two words of its own will do
   ("Each bottle is 350ml"), when its second half is given a subject. */
const LOOSE_JOIN = /,\s+|;\s+|\s+[—–]\s+|\s+and\s+/g;
const HALF_STEMS = 2;

function looseHalves(claim: string): [string, string] | null {
  const flat = claim.replace(/[.]$/, "");
  for (const join of flat.matchAll(LOOSE_JOIN)) {
    const at = join.index ?? 0;
    const head = flat.slice(0, at).trim();
    const rest = flat.slice(at + join[0].length).trim();
    if (
      contentStems(head).size >= HALF_STEMS &&
      contentStems(rest).size >= HALF_STEMS
    ) {
      return [upperFirst(head), rest];
    }
  }
  return null;
}

function withSubject(rest: string): string {
  const text = rest.trim();
  const verb = SUBJECTLESS_VERB.exec(text)?.[0];
  if (!verb) return text;
  const plural = /^(?:are|were|have)$/i.test(verb) || !/s$/i.test(verb);
  return `${plural ? "They" : "It"} ${text[0].toLowerCase()}${text.slice(1)}`;
}

/* A bare claim ("Doors open on 3 March") under its own headline only says
   it twice; the brief's sentence that holds it says more in words no
   reader can call invented. */
function briefSentencesOn(
  claim: string,
  headline: string,
  briefText: string,
  others: readonly string[],
  free: ReadonlySet<string>,
): string[] {
  const about = contentStems(`${claim} ${headline}`);
  if (about.size === 0) return [];
  return briefText
    .split(/(?<=[.!?])\s+/)
    .map((s) => asSentence(s))
    .filter(
      (s) =>
        fitsSubheadline(s) &&
        [...contentStems(s)].some((w) => about.has(w)) &&
        /* A sentence that makes another frame's point moves the repeat
           rather than clearing it. */
        !others.some((other) => textsOverlap(s, other, free)),
    );
}

interface VersionContext {
  /** Every other frame's headline and subheadline. */
  others?: readonly string[];
  /** The names any frame may say (namesFree). */
  free?: ReadonlySet<string>;
}

/** The ways a frame can say only its own point, plainest last. */
export function plainVersions(
  beat: FrameBeat,
  claim: string,
  kind: PlannedSequence["kind"],
  briefText = "",
  { others = [], free = new Set<string>() }: VersionContext = {},
): { change: Partial<FrameBeat>; what: string }[] {
  const point = claim.trim().replace(/\s+/g, " ");
  const versions: { change: Partial<FrameBeat>; what: string }[] = [];
  const sentence = point ? asSentence(point) : "";
  const halves = point ? (claimHalves(point) ?? looseHalves(point)) : null;
  if (halves) {
    const [headline, rest] = halves;
    const subheadline = [asSentence(rest), asSentence(withSubject(rest))].find(
      fitsSubheadline,
    );
    if (fitsHeadline(headline, kind) && subheadline) {
      versions.push({
        change: { headline, subheadline },
        what: "its point as headline and subheadline",
      });
    }
    /* A hook's point often opens on its name ("Ata Kitchen's sauce, made
       in small batches in Ibadan"): the reason leads and the name goes
       under it. */
    const reason = upperFirst(rest.replace(/[.]$/, ""));
    const named = asSentence(headline);
    if (
      beat.role === "hook" &&
      fitsHeadline(reason, kind) &&
      fitsSubheadline(named)
    ) {
      versions.push({
        change: { headline: reason, subheadline: named },
        what: "its point's reason over its name",
      });
    }
  }
  if (sentence && fitsSubheadline(sentence)) {
    versions.push({
      change: { subheadline: sentence },
      what: "its point under its headline",
    });
    const title = beat.title.trim();
    if (title && fitsHeadline(title, kind)) {
      versions.push({
        change: { headline: title, subheadline: sentence },
        what: "its title over its point",
      });
    }
  }
  const asHeadline = point.replace(/[.]$/, "");
  if (asHeadline && fitsHeadline(asHeadline, kind)) {
    versions.push({
      change: { headline: asHeadline },
      what: "its point as the headline",
    });
  }
  for (const line of briefSentencesOn(
    point,
    beat.headline,
    briefText,
    others,
    free,
  )) {
    versions.push({
      change: { subheadline: line },
      what: "the brief's own sentence on its point under its headline",
    });
    if (asHeadline && fitsHeadline(asHeadline, kind) && line !== sentence) {
      versions.push({
        change: { headline: asHeadline, subheadline: line },
        what: "its point over the brief's own sentence on it",
      });
    }
  }
  if (beat.role === "cta" && beat.subheadline.trim()) {
    versions.push({
      change: { subheadline: "" },
      what: "its subheadline cut",
    });
  }
  return versions;
}

const SENTENCE = /(?<=[.!?])\s+(?=\S)/;
const FOOTER_ITEM = /\s+·\s+/;

/** Each version of a frame with one line a reader sees taken away: a
 *  footer item, or one sentence of the subheadline. */
export function lineCuts(
  beat: FrameBeat,
  released: readonly BriefFact[] = [],
): Partial<FrameBeat>[] {
  const cuts: Partial<FrameBeat>[] = [];
  beat.footerLines.forEach((line, n) => {
    const items = line.split(FOOTER_ITEM);
    items.forEach((item, k) => {
      for (const fact of released) {
        const trimmed = withoutFactText(item, fact);
        if (!trimmed || trimmed === item) continue;
        const kept = items.map((it, j) => (j === k ? trimmed : it)).join(" · ");
        cuts.push({
          footerLines: beat.footerLines.map((l, j) => (j === n ? kept : l)),
        });
      }
      const kept = items.filter((__, j) => j !== k).join(" · ");
      const footerLines = beat.footerLines.flatMap((l, j) =>
        j === n ? (kept ? [kept] : []) : [l],
      );
      cuts.push({ footerLines });
    });
  });
  const sentences = beat.subheadline.split(SENTENCE).filter(Boolean);
  sentences.forEach((_, k) => {
    cuts.push({
      subheadline: sentences.filter((__, j) => j !== k).join(" "),
    });
  });
  return cuts;
}

/* How many of each line the cross pairing tries: enough to pair any
   writer's headline with any other's subheadline on a set of 8 frames
   in well under a second. */
const CROSS_LINES = 8;

type Version = { change: Partial<FrameBeat>; what: string };

/** Every headline the versions give paired with every subheadline they
 *  give: one writer's line over another's is often the clean frame
 *  neither wrote whole ("Back washed and ironed by Wednesday?" over the
 *  other draft's sentence, without the "two days later" no source gives). */
export function crossVersions(
  beat: FrameBeat,
  versions: readonly Version[],
  kind: PlannedSequence["kind"],
): Version[] {
  const headlines = [
    ...new Set(
      [beat.headline, ...versions.map((v) => v.change.headline ?? "")]
        .map((h) => h.trim())
        .filter((h) => h && fitsHeadline(h, kind)),
    ),
  ].slice(0, CROSS_LINES);
  const subheadlines = [
    ...new Set(
      [beat.subheadline, ...versions.map((v) => v.change.subheadline ?? "")]
        .map((h) => h.trim())
        .filter((h) => h && fitsSubheadline(h)),
    ),
  ].slice(0, CROSS_LINES);
  const given = new Set(
    versions.map(
      (v) =>
        `${v.change.headline ?? beat.headline}|${v.change.subheadline ?? beat.subheadline}`,
    ),
  );
  const out: Version[] = [];
  for (const headline of headlines) {
    for (const subheadline of subheadlines) {
      const key = `${headline}|${subheadline}`;
      if (given.has(key) || key === `${beat.headline}|${beat.subheadline}`) {
        continue;
      }
      out.push({
        change: { headline, subheadline },
        what: "one writer's headline over another's subheadline",
      });
    }
  }
  return out;
}

/* Where a sentence's first clause ends and what it adds begins: "Every
   bean comes from the plateau, where cooler air slows the cherry" says
   its point in the first clause and invents in the second. */
const CLAUSE_BREAK =
  /,\s+(?=(?:where|which|so|and|while|because|as|with|giving|making|meaning)\b)|\s+[—–]\s+|;\s+/i;
const CLAUSE_MIN_WORDS = 4;

/** Each subheadline the versions give, cut to its first clause: a writer's
 *  sentence whose tail the gate refused often holds a whole sentence
 *  before it. */
export function clauseCuts(versions: readonly Version[]): Version[] {
  const out: Version[] = [];
  for (const v of versions) {
    const sub = v.change.subheadline?.trim() ?? "";
    const parts = sub.split(CLAUSE_BREAK);
    if (parts.length < 2) continue;
    const head = asSentence(parts[0].replace(/[,;:]\s*$/, ""));
    if (head.split(/\s+/).length < CLAUSE_MIN_WORDS || !fitsSubheadline(head)) {
      continue;
    }
    out.push({
      change: { ...v.change, subheadline: head },
      what: `${v.what}, to its first clause`,
    });
  }
  return out;
}

/* Words no source gives, said where a reader can do without them:
   "only", "free", "one flat", "now have". Taken out whole, or word by
   word ("One flat price" is "One price" or "Price"), the line still says
   its point; a figure is never cut, since what is left would not read.
   The set's fault score decides which cut, if any, reads. */
const CUTTABLE_WORD = /^[\p{L}][\p{L}'-]*$/u;
const CUTTABLE_WORDS = 3;
const INVENTED = /^it states "([^"]+)"/;

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function cutPhrase(text: string, phrase: string): string {
  const pattern = new RegExp(
    `\\s*(?<![\\p{L}\\p{N}'-])${phrase.split(/\s+/).map(escaped).join("\\s+")}(?![\\p{L}\\p{N}'-])`,
    "giu",
  );
  return upperFirst(
    text
      .replace(pattern, "")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/^[\s,;:]+/, "")
      .replace(/\s{2,}/g, " ")
      .trim(),
  );
}

/** The frame's lines with each invented phrase of up to three words
 *  (`it states "X"`) taken out of whichever line says it: the whole
 *  phrase, then each of its words. */
export function inventedWordCuts(
  beat: FrameBeat,
  faults: readonly CopyFault[],
): Version[] {
  const phrases = faults.flatMap((f) => {
    const phrase = INVENTED.exec(f.detail)?.[1]?.trim() ?? "";
    const words = phrase.split(/\s+/).filter(Boolean);
    return words.length > 0 &&
      words.length <= CUTTABLE_WORDS &&
      words.every((w) => CUTTABLE_WORD.test(w))
      ? [phrase]
      : [];
  });
  const cuts = new Set<string>();
  for (const phrase of phrases) {
    cuts.add(phrase);
    for (const word of phrase.split(/\s+/)) cuts.add(word);
  }
  const out: Version[] = [];
  for (const phrase of cuts) {
    const headline = cutPhrase(beat.headline, phrase);
    const subheadline = cutPhrase(beat.subheadline, phrase);
    if (
      (headline !== beat.headline || subheadline !== beat.subheadline) &&
      headline
    ) {
      out.push({
        change: { headline, subheadline },
        what: `"${phrase}", which no source gives, cut`,
      });
    }
  }
  return out;
}

/** The brief first, then the profile and the owner's own words: a
 *  sentence any of them gives on a frame's point is no invention. */
export function sourceTextOf(rules: FaultRules): string {
  return [
    rules.briefText ?? "",
    ...(rules.titleSources ?? []).filter((t) => t !== rules.briefText),
  ]
    .map((t) => asSentence(t.trim()))
    .filter((t) => t.length > 1)
    .join(" ");
}

const coverageLost = (faults: readonly CopyFault[]) =>
  faults.filter((f) => f.weight >= COVERAGE).length;

/**
 * The set with the lines that breach it cut (CopyFault.breach): a removed
 * point said in small print, a claim no source gives, a fact the owner
 * took out. Saying less is always allowed; saying what the owner took out
 * never is. A cut is kept only where the set ends with fewer breaches and
 * no brief fact or offering newly left off.
 */
export function withBreachesCut(
  plan: PlannedSequence,
  rules: FaultRules,
  tidy: (frames: readonly FrameBeat[]) => FrameBeat[] = (frames) => [...frames],
  draw: (plan: PlannedSequence) => PlannedSequence = (p) => p,
): { plan: PlannedSequence; applied: string[] } {
  let current = plan;
  let faults = setFaults(current, rules);
  const applied: string[] = [];
  let improved = true;
  while (improved && breaches(faults).length > 0) {
    improved = false;
    const frames = [...new Set(breaches(faults).map((f) => f.frame))];
    for (const frame of frames) {
      const beat = current.frames[frame];
      if (!beat) continue;
      for (const change of lineCuts(
        beat,
        unsayable(
          rules.facts,
          rules.released ?? [],
          rules.owned ?? [],
          rules.claims?.[frame] ?? "",
        ),
      )) {
        const cut: PlannedSequence = {
          ...current,
          frames: tidy(
            current.frames.map((b, i) =>
              i === frame ? { ...b, ...change } : b,
            ),
          ),
        };
        /* A footer that breached may have been the only line giving a
           fact the owner kept ("Gold partner package ₦15,000,000" on the
           wrong slide): it is drawn again on its own frame. */
        const cutFaults = setFaults(cut, rules);
        const next =
          coverageLost(cutFaults) > coverageLost(faults) ? draw(cut) : cut;
        const nextFaults = next === cut ? cutFaults : setFaults(next, rules);
        if (
          breaches(nextFaults).length < breaches(faults).length &&
          coverageLost(nextFaults) <= coverageLost(faults)
        ) {
          current = next;
          faults = nextFaults;
          applied.push(`frame ${frame + 1}: a line that breached cut`);
          improved = true;
          break;
        }
      }
    }
  }
  return { plan: current, applied };
}

/* A fault on one frame often names the frame it collides with ("the
   hook already says what frame 3 is for"): the collision clears from
   either end, so the other frame's own plain versions are tried too. */
const NAMED_FRAME = /\bframe (\d+)\b/g;

/** The frames whose rewrite could clear `fault`, the one most worth
 *  rewriting first: a later frame before the hook, since the hook is what
 *  earned the swipe; otherwise the faulted frame before the one it
 *  names. */
export function framesToTry(fault: CopyFault, count: number): number[] {
  const named = [...fault.detail.matchAll(NAMED_FRAME)]
    .map((m) => Number(m[1]) - 1)
    .filter((i) => i >= 0 && i < count && i !== fault.frame);
  const partners = [...new Set(named)];
  return fault.frame === 0
    ? [...partners, fault.frame]
    : [fault.frame, ...partners];
}

const faultKey = (f: CopyFault) => `${f.frame}|${f.detail}`;

/* Versions of each frame a two-frame repair pairs: the writers' and code's
   plainest, before the cross pairings. */
const PAIR_VERSIONS = 10;

/* Versions the last resort reads in one call before it stops searching:
   a count, not a clock, so a replay ends where the job did. Each read is
   a full setFaults (about 20ms on an 8-frame set), so one call stays
   near ten seconds at worst; on the tuning snapshots 600 clears as many
   sets as 1500. */
export const LAST_RESORT_TRIALS = 600;

/** Copy another writer gave a frame: the second draft's version of it,
 *  or an opening the writers offered beside their own hook. */
export type AlternateCopy = Partial<
  Pick<FrameBeat, "headline" | "subheadline" | "footerLines" | "cta">
>;

/** `tidy` settles what follows from a frame's copy (its title, the set's
 *  casing) after a rewrite, as the planner does after every rewrite.
 *  `alternates` holds, by frame, copy the writers already gave it for its
 *  own claim: tried beside code's plain versions, at no extra call. */
export function lastResort(
  plan: PlannedSequence,
  rules: FaultRules,
  claims: readonly string[],
  tidy: (frames: readonly FrameBeat[]) => FrameBeat[] = (frames) => [...frames],
  alternates: readonly (readonly AlternateCopy[])[] = [],
  draw: (plan: PlannedSequence) => PlannedSequence = (p) => p,
): LastResortResult {
  let current = plan;
  let score = blockingScore(current, rules);
  const applied: string[] = [];
  let trials = LAST_RESORT_TRIALS;
  const scored = (next: PlannedSequence) => {
    trials -= 1;
    return blockingScore(next, rules);
  };
  const sourceText = sourceTextOf(rules);
  const versionsOf = (frame: number): Version[] => {
    const beat = current.frames[frame];
    if (!beat) return [];
    const own: Version[] = [
      ...(alternates[frame] ?? []).map((change) => ({
        change,
        what: "another writer's version of it",
      })),
      ...plainVersions(beat, claims[frame] ?? "", current.kind, sourceText, {
        others: current.frames
          .filter((_, i) => i !== frame)
          .map((b) => `${b.headline} ${b.subheadline}`),
        free: namesFree(rules.brandName, rules.offering),
      }),
    ];
    const onFrame = setFaults(current, rules).filter((f) => f.frame === frame);
    own.push(...clauseCuts(own));
    return [
      ...own,
      ...inventedWordCuts(beat, onFrame),
      ...crossVersions(beat, own, current.kind),
      ...lineCuts(beat).map((change) => ({
        change,
        what: "a line that said another frame's point cut",
      })),
    ];
  };
  const withChange = (
    plan: PlannedSequence,
    frame: number,
    change: Partial<FrameBeat>,
  ): PlannedSequence => ({
    ...plan,
    frames: tidy(
      plan.frames.map((b, i) => (i === frame ? { ...b, ...change } : b)),
    ),
  });
  const bestOf = (frame: number) => {
    let best: { plan: PlannedSequence; score: number; what: string } | null =
      null;
    for (const { change, what } of versionsOf(frame)) {
      if (trials <= 0) break;
      const next = withChange(current, frame, change);
      const nextScore = scored(next);
      if (nextScore < (best?.score ?? score)) {
        best = { plan: next, score: nextScore, what };
      }
    }
    return best;
  };
  /* Two frames that collide may each need rewriting for either to come
     clean: the hook told off frame 5's point, and frame 5 no longer able
     to leave it, clears only when both change at once. */
  const bestPair = (a: number, b: number) => {
    let best: { plan: PlannedSequence; score: number; what: string } | null =
      null;
    const ofA = versionsOf(a).slice(0, PAIR_VERSIONS);
    const ofB = versionsOf(b).slice(0, PAIR_VERSIONS);
    for (const va of ofA) {
      const half = withChange(current, a, va.change);
      for (const vb of ofB) {
        if (trials <= 0) return best;
        const next = withChange(half, b, vb.change);
        const nextScore = scored(next);
        if (nextScore < (best?.score ?? score)) {
          best = {
            plan: next,
            score: nextScore,
            what: `${va.what}, and frame ${b + 1}: ${vb.what}`,
          };
        }
      }
    }
    return best;
  };
  for (let pass = 0; pass < PASSES && score > 0; pass += 1) {
    const faults = blockingFaults(setFaults(current, rules));
    for (const fault of faults) {
      const standing = new Set(
        blockingFaults(setFaults(current, rules)).map(faultKey),
      );
      if (!standing.has(faultKey(fault))) continue;
      const tried = framesToTry(fault, current.frames.length);
      let fixed = false;
      for (const frame of tried) {
        const best = bestOf(frame);
        if (!best) continue;
        current = best.plan;
        score = best.score;
        applied.push(`frame ${frame + 1}: ${best.what}`);
        fixed = true;
        break;
      }
      if (fixed || tried.length < 2) continue;
      const pair = bestPair(tried[0], tried[1]);
      if (!pair) continue;
      current = pair.plan;
      score = pair.score;
      applied.push(`frame ${tried[0] + 1}: ${pair.what}`);
    }
  }
  /* With nothing blocking left to clear, the faults a reader still
     notices (a headline past its word budget, a price read wider than the
     brief prices it) are cleared the same way, where that costs no
     blocking fault. */
  for (const frame of new Set(
    setFaults(current, rules)
      .filter((f) => f.weight < MAJOR)
      .map((f) => f.frame),
  )) {
    const total = faultScore(setFaults(current, rules));
    let best: { plan: PlannedSequence; total: number; what: string } | null =
      null;
    for (const { change, what } of versionsOf(frame)) {
      if (trials <= 0) break;
      const next = withChange(current, frame, change);
      if (scored(next) > score) continue;
      const nextTotal = faultScore(setFaults(next, rules));
      if (nextTotal < (best?.total ?? total)) {
        best = { plan: next, total: nextTotal, what };
      }
    }
    if (best) {
      current = best.plan;
      score = blockingScore(current, rules);
      applied.push(`frame ${frame + 1}: ${best.what}`);
    }
  }
  const cut = withBreachesCut(current, rules, tidy, draw);
  const left = setFaults(cut.plan, rules);
  return {
    plan: cut.plan,
    applied: [...applied, ...cut.applied],
    blocking: blockingFaults(left),
    breaches: breaches(left),
  };
}
