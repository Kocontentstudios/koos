import { formatRules } from "@/lib/design/formats";
import { type BriefFact, factStated } from "@/lib/jobs/directions/brief-facts";
import { copyNamesOffering } from "@/lib/jobs/directions/finalize";
import { COPY_LIMITS, DRAFT_LIMITS } from "@/lib/jobs/directions/schema";
import { sameComposition } from "@/lib/jobs/directions/subject-layout";
import {
  contentStems,
  headlineOverlap,
  isNearDuplicateHeadline,
} from "@/lib/jobs/directions/text-overlap";
import type {
  FrameBeat,
  PlannedSequence,
  SequenceKind,
  SequenceProblem,
} from "./contract";

export interface SequenceRules {
  frameCount: number;
  facts: readonly BriefFact[];
  offering: string | null;
  /** Whether the set has an image to draw (an upload or a KO plate). */
  hasImage: boolean;
  /** Words every frame may share without repeating itself: the brand's
   *  name ("Crumb & Co." on two headlines is not one idea twice). */
  brandName?: string | null;
}

const MAX_FOOTER_LINES = DRAFT_LIMITS.footerLines;

const wordsIn = (text: string) =>
  text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

const WORD_BUDGET = " words, over the ";

/** A headline past the format's word budget: drawable, so it weighs less
 *  than a problem that loses the frame (plan.ts planScore). */
export function isWordBudgetProblem(problem: SequenceProblem): boolean {
  return problem.rule === "copy-length" && problem.detail.includes(WORD_BUDGET);
}

/** The copy fields of a frame as the fact checks read them. */
export function frameCopy(beat: FrameBeat) {
  return {
    headline: beat.headline,
    subheadline: beat.subheadline,
    cta: beat.cta,
    footerLines: beat.footerLines,
  };
}

/**
 * Copy a frame cannot be drawn with: past a DesignSpec limit, empty where
 * the spec needs text, or more footer lines than the footer draws. `budget`
 * adds the format's headline word budget (formatRules), which is a target a
 * frame can miss by a word and still be drawn, so a caller holding a
 * user's own words leaves it off.
 */
export function copyLimitProblems(
  beat: FrameBeat,
  frame: number,
  kind: SequenceKind,
  { budget = true }: { budget?: boolean } = {},
): SequenceProblem[] {
  const problems: SequenceProblem[] = [];
  const over = (field: string, text: string, limit: number) => {
    if (text.length > limit) {
      problems.push({
        frame,
        rule: "copy-length",
        detail: `the ${field} is ${text.length} characters, over the ${limit} a frame draws`,
      });
    }
  };
  if (!beat.headline.trim()) {
    problems.push({
      frame,
      rule: "copy-length",
      detail: "the headline is empty",
    });
  }
  if (!beat.title.trim()) {
    problems.push({ frame, rule: "copy-length", detail: "the title is empty" });
  }
  over("title", beat.title, COPY_LIMITS.title);
  over("headline", beat.headline, COPY_LIMITS.headline);
  over("subheadline", beat.subheadline, COPY_LIMITS.subheadline);
  over("button", beat.cta, COPY_LIMITS.cta);
  for (const line of beat.footerLines) {
    over("footer line", line, COPY_LIMITS.footerLine);
  }
  if (beat.footerLines.length > MAX_FOOTER_LINES) {
    problems.push({
      frame,
      rule: "copy-length",
      detail: `${beat.footerLines.length} footer lines, over the ${MAX_FOOTER_LINES} the footer draws`,
    });
  }
  const words = wordsIn(beat.headline);
  const headlineWords = formatRules(kind).headlineWords;
  if (budget && words > headlineWords) {
    problems.push({
      frame,
      rule: "copy-length",
      detail: `the headline is ${words}${WORD_BUDGET}${headlineWords} a ${kind} frame is read in`,
    });
  }
  return problems;
}

/** The hook-first, cta-last and cta-only-last rules alone. */
export function roleProblems(frames: readonly FrameBeat[]): SequenceProblem[] {
  const problems: SequenceProblem[] = [];
  const last = frames.length - 1;
  if (frames[0] && frames[0].role !== "hook") {
    problems.push({
      frame: 0,
      rule: "hook-first",
      detail: `the first frame is a ${frames[0].role} frame, not the hook`,
    });
  }
  frames.forEach((beat, i) => {
    if (i > 0 && beat.role === "hook") {
      problems.push({
        frame: i,
        rule: "hook-first",
        detail: "only the first frame is the hook",
      });
    }
  });
  const end = frames[last];
  if (end && end.role !== "cta") {
    problems.push({
      frame: last,
      rule: "cta-last",
      detail: `the last frame is a ${end.role} frame, not the call to action`,
    });
  } else if (end && !end.cta.trim()) {
    problems.push({
      frame: last,
      rule: "cta-last",
      detail: "the last frame has no button",
    });
  }
  frames.forEach((beat, i) => {
    if (i === last) return;
    if (beat.role === "cta" || beat.cta.trim()) {
      problems.push({
        frame: i,
        rule: "cta-only-last",
        detail: beat.cta.trim()
          ? `frame ${i + 1} carries a button ("${beat.cta}"); only the last frame does`
          : `frame ${i + 1} is a call-to-action frame; only the last frame is`,
      });
    }
  });
  return problems;
}

/* Neighbours only: the same layout three frames apart is the rhythm a pack
   is built on (module 10), side by side it is one frame drawn twice. Two
   layouts one builder draws as the same centred card count as one. */
function layoutProblems(frames: readonly FrameBeat[]): SequenceProblem[] {
  const problems: SequenceProblem[] = [];
  for (let i = 1; i < frames.length; i += 1) {
    const [before, here] = [frames[i - 1].layout, frames[i].layout];
    if (sameComposition(before, here)) {
      problems.push({
        frame: i,
        rule: "layout-repeat",
        detail:
          before === here
            ? `frame ${i + 1} uses ${here}, the same layout as frame ${i}`
            : `frame ${i + 1} (${here}) draws the same card as frame ${i} (${before})`,
      });
    }
  }
  return problems;
}

function headlineProblems(
  frames: readonly FrameBeat[],
  ignore: ReadonlySet<string>,
): SequenceProblem[] {
  const problems: SequenceProblem[] = [];
  frames.forEach((beat, j) => {
    for (let i = 0; i < j; i += 1) {
      const other = frames[i].headline;
      if (!other.trim() || !beat.headline.trim()) continue;
      if (isNearDuplicateHeadline(other, beat.headline, ignore)) {
        problems.push({
          frame: j,
          rule: "headline-repeat",
          detail: `frame ${j + 1}'s headline "${beat.headline}" says what frame ${i + 1}'s "${other}" says (${Math.round(headlineOverlap(other, beat.headline, ignore) * 100)}% shared)`,
        });
        return;
      }
    }
  });
  return problems;
}

/** The facts no frame states. Coverage is the set's, not each frame's
 *  (H5): the price may sit on frame 3 and the venue on the last. */
export function factsUncovered(
  frames: readonly FrameBeat[],
  facts: readonly BriefFact[],
): BriefFact[] {
  return facts.filter(
    (fact) => !frames.some((beat) => factStated(fact, frameCopy(beat))),
  );
}

/** Every rule a plan breaks (contract SequenceRule). Pure; [] is a pass. */
export function validateSequence(
  plan: PlannedSequence,
  rules: SequenceRules,
): SequenceProblem[] {
  const { frames } = plan;
  const problems: SequenceProblem[] = [];
  if (frames.length !== rules.frameCount) {
    problems.push({
      frame: null,
      rule: "count",
      detail: `${frames.length} frames where ${rules.frameCount} were asked for`,
    });
  }
  problems.push(...roleProblems(frames));
  problems.push(...layoutProblems(frames));
  problems.push(
    ...headlineProblems(frames, contentStems(rules.brandName ?? "")),
  );
  frames.forEach((beat, i) => {
    problems.push(...copyLimitProblems(beat, i, plan.kind));
  });
  for (const fact of factsUncovered(frames, rules.facts)) {
    problems.push({
      frame: null,
      rule: "fact-uncovered",
      detail: `no frame states "${fact.text}"`,
    });
  }
  const hook = frames[0];
  if (hook && rules.offering && !copyNamesOffering(hook, rules.offering)) {
    problems.push({
      frame: 0,
      rule: "offering-unnamed",
      detail: `the hook does not name "${rules.offering}"`,
    });
  }
  if (hook && rules.hasImage && !hook.showsImage) {
    problems.push({
      frame: 0,
      rule: "hook-without-image",
      detail: "the set has an image and the hook is drawn without it",
    });
  }
  return problems;
}
