import type { ExtractionEvalCase } from "./cases";

export interface CaseScore {
  id: string;
  /** Expected fields the model actually filled. */
  recall: number;
  /** Of the filled expected fields, how many carry the right value. */
  valueAccuracy: number;
  /** Forbidden fields the model filled anyway — invented content. */
  invented: string[];
  missed: string[];
  wrongValue: string[];
}

function filled(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Pure scoring. Same transcript and same extraction always score the same, so
 * none of this belongs in a judge — only the extraction call itself is paid
 * and non-deterministic.
 */
export function scoreCase(
  evalCase: ExtractionEvalCase,
  fields: Record<string, unknown>,
): CaseScore {
  const expectedKeys = Object.keys(evalCase.expected);
  const missed: string[] = [];
  const wrongValue: string[] = [];

  for (const key of expectedKeys) {
    const value = fields[key];
    if (!filled(value)) {
      missed.push(key);
      continue;
    }
    const haystack = value.toLowerCase();
    const rule = evalCase.expected[key];
    const hasAll = rule.contains.every((needle) =>
      haystack.includes(needle.toLowerCase()),
    );
    const hasNone = (rule.notContains ?? []).every(
      (needle) => !haystack.includes(needle.toLowerCase()),
    );
    if (!hasAll || !hasNone) wrongValue.push(key);
  }

  const invented = evalCase.forbidden.filter((key) => filled(fields[key]));
  const found = expectedKeys.length - missed.length;

  return {
    id: evalCase.id,
    recall: expectedKeys.length === 0 ? 1 : found / expectedKeys.length,
    valueAccuracy: found === 0 ? 0 : (found - wrongValue.length) / found,
    invented,
    missed,
    wrongValue,
  };
}

export interface EvalThresholds {
  minRecall: number;
  minValueAccuracy: number;
  maxInventedPerCase: number;
}

export function casePassed(
  score: CaseScore,
  thresholds: EvalThresholds,
): boolean {
  return (
    score.recall >= thresholds.minRecall &&
    score.valueAccuracy >= thresholds.minValueAccuracy &&
    score.invented.length <= thresholds.maxInventedPerCase
  );
}

export function aggregate(scores: CaseScore[]) {
  const mean = (pick: (s: CaseScore) => number) =>
    scores.length === 0
      ? 0
      : scores.reduce((sum, s) => sum + pick(s), 0) / scores.length;
  return {
    recall: mean((s) => s.recall),
    valueAccuracy: mean((s) => s.valueAccuracy),
    invented: scores.reduce((sum, s) => sum + s.invented.length, 0),
  };
}
