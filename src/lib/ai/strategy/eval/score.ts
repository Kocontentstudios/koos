import type { Strategy } from "@/lib/ai/strategy-schema";
import type { StrategyEvalCase } from "./cases";

export interface StrategyCaseScore {
  id: string;
  campaignName: string;
  /** 1 when the campaign name carries the chat's topic, else 0. */
  nameFocus: number;
  /** Share of the objective's factual anchors that survived into the strategy. */
  objectiveFocus: number;
  /** Topics the user set aside that reached the campaign name anyway. */
  mixedTopics: string[];
  /** Schema-shape problems that make the card unrenderable. */
  shapeErrors: string[];
}

const BOILERPLATE_PREFIXES = [
  "campaign for ",
  "content strategy for ",
  "marketing campaign for ",
  "social media campaign for ",
];

/** Lowercase, and drop the thousands separators a model writes but an anchor
 * does not ("1,000" and "1000" are the same fact). */
function normalize(text: string): string {
  return text.toLowerCase().replace(/(\d),(?=\d)/g, "$1");
}

function containsAny(haystack: string, needles: string[]): boolean {
  const text = normalize(haystack);
  return needles.some((n) => text.includes(normalize(n)));
}

/**
 * Pure scoring. A campaign name either carries the chat's topic or it does
 * not, so none of this is a judge's call — only the generation itself is paid
 * and non-deterministic.
 */
export function scoreStrategyCase(
  evalCase: StrategyEvalCase,
  strategy: Strategy,
  maxNameLength: number,
): StrategyCaseScore {
  const name = strategy.campaignName.trim();
  const objectiveText = `${strategy.objective} ${strategy.keyMessage}`;

  // Each group is a set of acceptable phrasings for ONE fact, so a group
  // counts once when any of its alternates lands. Requiring every spelling of
  // the same fact would measure vocabulary, not focus.
  const objectiveHits = evalCase.objectiveAnchors.filter((alternates) =>
    containsAny(objectiveText, alternates),
  ).length;

  const shapeErrors: string[] = [];
  if (name.length === 0) shapeErrors.push("empty campaign name");
  if (name.length > maxNameLength)
    shapeErrors.push(`campaign name over ${maxNameLength} chars`);
  if (BOILERPLATE_PREFIXES.some((p) => name.toLowerCase().startsWith(p)))
    shapeErrors.push("boilerplate campaign name prefix");
  if (strategy.channels.length === 0) shapeErrors.push("no channels");
  if (strategy.timeline.length === 0) shapeErrors.push("no timeline phases");

  return {
    id: evalCase.id,
    campaignName: name,
    nameFocus: containsAny(name, evalCase.nameAnchors) ? 1 : 0,
    objectiveFocus:
      evalCase.objectiveAnchors.length === 0
        ? 1
        : objectiveHits / evalCase.objectiveAnchors.length,
    mixedTopics: evalCase.strayTopics.filter((topic) =>
      containsAny(name, [topic]),
    ),
    shapeErrors,
  };
}

export interface StrategyEvalThresholds {
  minNameFocus: number;
  minObjectiveFocus: number;
  maxMixedPerCase: number;
  maxNameLength: number;
}

export function strategyCasePassed(
  score: StrategyCaseScore,
  thresholds: StrategyEvalThresholds,
): boolean {
  return (
    score.nameFocus >= thresholds.minNameFocus &&
    score.objectiveFocus >= thresholds.minObjectiveFocus &&
    score.mixedTopics.length <= thresholds.maxMixedPerCase &&
    score.shapeErrors.length === 0
  );
}

export function aggregateStrategy(scores: StrategyCaseScore[]) {
  const mean = (pick: (s: StrategyCaseScore) => number) =>
    scores.length === 0
      ? 0
      : scores.reduce((sum, s) => sum + pick(s), 0) / scores.length;
  return {
    nameFocus: mean((s) => s.nameFocus),
    objectiveFocus: mean((s) => s.objectiveFocus),
    mixed: scores.reduce((sum, s) => sum + s.mixedTopics.length, 0),
    shapeErrors: scores.reduce((sum, s) => sum + s.shapeErrors.length, 0),
  };
}
