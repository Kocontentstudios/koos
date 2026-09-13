import type { DesignSpec } from "@/lib/design/spec";

export interface LogoVerdictShape {
  logoCount: number;
  corner: string;
  distorted: boolean;
  overlapsText: boolean;
}

export interface LogoEvalScore {
  id: string;
  /** The mark is there, exactly once. */
  present: boolean;
  /** It landed in the corner the spec asked for. */
  placed: boolean;
  /** Undistorted and clear of the copy. */
  clean: boolean;
}

/**
 * Scored by arithmetic over the judge's reading, not by a second opinion.
 * "Is there exactly one logo, in the corner we asked for, undistorted and off
 * the text" has one correct answer once the pixels have been read.
 */
export function scoreLogoCase(
  id: string,
  expect: { logo: boolean; placement: DesignSpec["logoPlacement"] },
  verdict: LogoVerdictShape,
): LogoEvalScore {
  if (!expect.logo) {
    const absent = verdict.logoCount === 0;
    return { id, present: absent, placed: absent, clean: absent };
  }
  const present = verdict.logoCount === 1;
  return {
    id,
    present,
    placed: present && verdict.corner === expect.placement,
    clean: present && !verdict.distorted && !verdict.overlapsText,
  };
}

export const LOGO_EVAL_THRESHOLDS = {
  /** Non-negotiable: the ticket is that the logo is missing. */
  minPresent: 1,
  /** One model may nudge the mark off the exact corner it was given room in. */
  minPlaced: 0.8,
  minClean: 1,
};

export function aggregateLogoScores(scores: LogoEvalScore[]) {
  const rate = (pick: (s: LogoEvalScore) => boolean) =>
    scores.length === 0 ? 0 : scores.filter(pick).length / scores.length;
  const present = rate((s) => s.present);
  const placed = rate((s) => s.placed);
  const clean = rate((s) => s.clean);
  return {
    present,
    placed,
    clean,
    passed:
      present >= LOGO_EVAL_THRESHOLDS.minPresent &&
      placed >= LOGO_EVAL_THRESHOLDS.minPlaced &&
      clean >= LOGO_EVAL_THRESHOLDS.minClean,
  };
}
