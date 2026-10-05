import { placeholdersIn, suspectNumbersIn, words } from "@/lib/ai/eval-text";
import { formatRules, resolveDesignFormat } from "@/lib/design/formats";

/**
 * What can be measured about a design spec without asking a model.
 *
 * The benchmark's job is to say whether the training system changed anything
 * real. Most of "is this a good design" cannot be scored deterministically —
 * that is the judge's job, and a judge scoring work from the same model family
 * is weak evidence. These are the parts with one correct answer, so they are
 * computed rather than asked.
 */

export interface SpecScore {
  /** Headline within the format's budget: a thumbnail headline the length of
   *  a poster's is unreadable at the size it will be seen. */
  headlineWords: number;
  headlineBudget: number;
  withinBudget: boolean;
  /** A missing fact written as a placeholder rather than invented. */
  placeholders: string[];
  /** Digits that look like a phone number nobody supplied. The failure mode
   *  the training system's missing-information rule exists to prevent. */
  suspectNumbers: string[];
  layout: string;
}

/** Loose on purpose: specs stored before a field was removed still carry it,
 *  and the scorer's job is to read whatever copy a spec holds. */
export interface ScorableSpec {
  headline?: string;
  subheadline?: string;
  cta?: string;
  layout?: string;
  /** Removed from the live schema because nothing drew it; historic rows and
   *  the before-arm of a benchmark can still contain it. */
  bodyPoints?: string[];
}

export function scoreSpec(spec: ScorableSpec, designType: string): SpecScore {
  const budget = formatRules(resolveDesignFormat(designType)).headlineWords;
  /* Every copy field, because the model puts utility details wherever the
     schema gives it room — in practice bodyPoints — and a scorer that reads
     three of four fields reports a win as a miss. */
  const copy = [
    spec.headline,
    spec.subheadline,
    spec.cta,
    ...(spec.bodyPoints ?? []),
  ]
    .filter(Boolean)
    .join(" ");

  return {
    headlineWords: words(spec.headline ?? ""),
    headlineBudget: budget,
    withinBudget: words(spec.headline ?? "") <= budget,
    placeholders: placeholdersIn(copy),
    suspectNumbers: suspectNumbersIn(copy),
    layout: spec.layout ?? "",
  };
}

/** How many distinct layouts a run produced. The anti-repetition rule claims
 *  to raise this; one layout across five different briefs is the rut it
 *  exists to break. */
export function layoutVariety(scores: SpecScore[]): number {
  return new Set(scores.map((s) => s.layout).filter(Boolean)).size;
}
