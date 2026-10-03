import { formatRules, resolveDesignFormat } from "@/lib/design/formats";
import type { DesignSpec } from "@/lib/design/spec";

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

const PLACEHOLDER = /\[[A-Z][A-Z \-/]{2,}\]/g;
/* Long digit runs, which in a brief with no number supplied means the model
   produced one. Dates and prices are shorter and are checked by eye. */
const PHONE_LIKE = /\+?\d[\d\s\-()]{8,}\d/g;

export function words(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function scoreSpec(
  spec: Pick<DesignSpec, "headline" | "subheadline" | "cta" | "layout">,
  designType: string,
): SpecScore {
  const budget = formatRules(resolveDesignFormat(designType)).headlineWords;
  const copy = [spec.headline, spec.subheadline, spec.cta]
    .filter(Boolean)
    .join(" ");

  return {
    headlineWords: words(spec.headline ?? ""),
    headlineBudget: budget,
    withinBudget: words(spec.headline ?? "") <= budget,
    placeholders: [...copy.matchAll(PLACEHOLDER)].map((m) => m[0]),
    suspectNumbers: [...copy.matchAll(PHONE_LIKE)].map((m) => m[0].trim()),
    layout: spec.layout ?? "",
  };
}

/** How many distinct layouts a run produced. The anti-repetition rule claims
 *  to raise this; one layout across five different briefs is the rut it
 *  exists to break. */
export function layoutVariety(scores: SpecScore[]): number {
  return new Set(scores.map((s) => s.layout).filter(Boolean)).size;
}
