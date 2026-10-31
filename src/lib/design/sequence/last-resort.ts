import { contentStems } from "@/lib/jobs/directions/text-overlap";
import { upperFirst } from "./casing";
import type { FrameBeat, PlannedSequence } from "./contract";
import {
  blockingFaults,
  type CopyFault,
  type FaultRules,
  faultScore,
  setFaults,
} from "./faults";
import { asSentence, claimHalves, fitsHeadline, fitsSubheadline } from "./gate";

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
  /** Blocking faults left: the set must not ship with any. */
  blocking: CopyFault[];
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
): string[] {
  const about = contentStems(`${claim} ${headline}`);
  if (about.size === 0) return [];
  return briefText
    .split(/(?<=[.!?])\s+/)
    .map((s) => asSentence(s))
    .filter(
      (s) =>
        fitsSubheadline(s) && [...contentStems(s)].some((w) => about.has(w)),
    );
}

/** The ways a frame can say only its own point, plainest last. */
export function plainVersions(
  beat: FrameBeat,
  claim: string,
  kind: PlannedSequence["kind"],
  briefText = "",
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
  for (const line of briefSentencesOn(point, beat.headline, briefText)) {
    versions.push({
      change: { subheadline: line },
      what: "the brief's own sentence on its point under its headline",
    });
  }
  if (beat.role !== "body" && beat.subheadline.trim()) {
    versions.push({
      change: { subheadline: "" },
      what: "its subheadline cut",
    });
  }
  return versions;
}

/** `tidy` settles what follows from a frame's copy (its title, the set's
 *  casing) after a rewrite, as the planner does after every rewrite. */
export function lastResort(
  plan: PlannedSequence,
  rules: FaultRules,
  claims: readonly string[],
  tidy: (frames: readonly FrameBeat[]) => FrameBeat[] = (frames) => [...frames],
): LastResortResult {
  let current = plan;
  let score = blockingScore(current, rules);
  const applied: string[] = [];
  for (let pass = 0; pass < PASSES && score > 0; pass += 1) {
    const atFault = [
      ...new Set(blockingFaults(setFaults(current, rules)).map((f) => f.frame)),
    ].sort((a, b) => a - b);
    for (const frame of atFault) {
      const beat = current.frames[frame];
      if (!beat) continue;
      let best: { plan: PlannedSequence; score: number; what: string } | null =
        null;
      for (const { change, what } of plainVersions(
        beat,
        claims[frame] ?? "",
        current.kind,
        rules.briefText ?? "",
      )) {
        const next: PlannedSequence = {
          ...current,
          frames: tidy(
            current.frames.map((b, i) =>
              i === frame ? { ...b, ...change } : b,
            ),
          ),
        };
        const nextScore = blockingScore(next, rules);
        if (nextScore < (best?.score ?? score)) {
          best = { plan: next, score: nextScore, what };
        }
      }
      if (best) {
        current = best.plan;
        score = best.score;
        applied.push(`frame ${frame + 1}: ${best.what}`);
      }
    }
  }
  return {
    plan: current,
    applied,
    blocking: blockingFaults(setFaults(current, rules)),
  };
}
