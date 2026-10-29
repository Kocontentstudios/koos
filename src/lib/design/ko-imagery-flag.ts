/**
 * Whether KO paints images for design directions (FEATURE_KO_IMAGERY).
 *
 * Off by default (Oluwaseyi's ruling, round 8): KO plates for services,
 * events and briefs with no product kept shipping objects and run-down
 * scenes, so PR 1 ships directions on the client's own photo or laid out as
 * text, and KO imagery waits for its follow-up. Read here and nowhere else.
 * The pages that open the image-choice dialog (Design Studio, Calendar,
 * Strategy) hand it to the dialog through KoImageryProvider; off, the dialog
 * offers the client's upload or a text-led design with no image.
 */
export function koImageryEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return /^(?:1|true|on|yes)$/i.test(env.FEATURE_KO_IMAGERY?.trim() ?? "");
}

/** A KO-imagery request while the flag is off. */
export class KoImageryDisabledError extends Error {
  constructor() {
    super(
      "KO-generated images are not available yet. Upload your own photo, or choose no photo for a text-led design.",
    );
    this.name = "KoImageryDisabledError";
  }
}
