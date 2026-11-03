/**
 * Whether a carousel or presentation brief is generated as a set of frames
 * (FEATURE_MULTI_FRAME, KOOS-AI-002). Off, those formats keep the single
 * design they have always produced. Read here and nowhere else.
 */
export function multiFrameEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return /^(?:1|true|on|yes)$/i.test(env.FEATURE_MULTI_FRAME?.trim() ?? "");
}

export class MultiFrameDisabledError extends Error {
  constructor() {
    super(
      "Carousels and presentations as sets of frames are not available yet.",
    );
    this.name = "MultiFrameDisabledError";
  }
}
