import { briefAskedForNoLogo } from "@/lib/design/logo-placement";
import { contrastRatio, MIN_CONTRAST_RATIO } from "@/lib/design/palette";
import type { DesignSpec } from "@/lib/design/spec";
import { normalizeHex } from "@/lib/validation/hex";
import type { DesignSpecEvalCase } from "./cases";

export interface DesignSpecCaseScore {
  id: string;
  palette: DesignSpec["palette"];
  /** Every slot parsed as a hex. */
  validHex: boolean;
  /** A palette slot matches a colour the brand actually stated. Null when the
   *  brand stated no hexes, so the case is excluded rather than scored zero. */
  usesBrandColor: boolean | null;
  /** A slot lands in the hue the brand named. Null when no name was given. */
  honorsNamedColor: boolean | null;
  contrastOk: boolean;
  /** The art director gave a brand with a logo a real corner. Null when the
   *  case has no logo, so it is excluded rather than scored zero. */
  logoPlaced: boolean | null;
  /** It read the brief's intent about the logo correctly. Null when the case
   *  does not state an expectation. */
  logoFreeCorrect: boolean | null;
  /** The quote it offered is really in the brief. Null when it claimed no
   *  removal, since there is then nothing to ground. */
  logoFreeGrounded: boolean | null;
}

function slots(p: DesignSpec["palette"]): string[] {
  return [p.background, p.foreground, p.accent];
}

/** Dominant channel, used only to check a named colour reached the right family. */
function hueOf(hex: string): "red" | "green" | "blue" | null {
  const v = normalizeHex(hex);
  if (!v) return null;
  const r = Number.parseInt(v.slice(1, 3), 16);
  const g = Number.parseInt(v.slice(3, 5), 16);
  const b = Number.parseInt(v.slice(5, 7), 16);
  if (r === g && g === b) return null;
  if (r >= g && r >= b) return "red";
  if (g >= r && g >= b) return "green";
  return "blue";
}

/**
 * Pure scoring. Whether a palette slot equals a stated brand colour, and
 * whether two colours clear 4.5:1, both have one correct answer given the
 * output — so neither is asked of a judge. Only the generation is paid.
 */
export function scoreDesignSpecCase(
  testCase: DesignSpecEvalCase,
  spec: DesignSpec,
): DesignSpecCaseScore {
  const emitted = slots(spec.palette);
  const normalized = emitted.map(normalizeHex);
  const validHex = normalized.every((c) => c !== null);

  const wanted = testCase.brandHexes
    .map(normalizeHex)
    .filter((c): c is string => c !== null);
  const usesBrandColor =
    wanted.length === 0
      ? null
      : normalized.some((c) => c !== null && wanted.includes(c));

  const honorsNamedColor = testCase.expectedHue
    ? emitted.some((c) => hueOf(c) === testCase.expectedHue)
    : null;

  const fg = normalizeHex(spec.palette.foreground);
  const bg = normalizeHex(spec.palette.background);
  const contrastOk =
    fg !== null && bg !== null && contrastRatio(fg, bg) >= MIN_CONTRAST_RATIO;

  /* "none" is the failure the ticket is about. Scored only for a brand that
     has a logo AND a brief that did not ask for it to be left off — otherwise
     "none" is the correct answer. */
  const logoPlaced =
    testCase.hasLogo && !testCase.expectLogoFree
      ? spec.logoPlacement !== "none"
      : null;

  const logoFreeCorrect =
    testCase.expectLogoFree === undefined
      ? null
      : spec.logoFree === testCase.expectLogoFree;

  /* The guard the runtime applies. A model that answers logoFree without a
     quotation the brief actually contains is overridden in production, so an
     eval that only scored the boolean would pass a spec the product ignores.

     Scored only for a brand that HAS a logo. Where there is none the prompt
     asks for logoFree with an empty quote and the placement is structural —
     there is no claim about the brief to ground, and counting those as misses
     reported 0.20 for a model that was answering correctly. */
  const logoFreeGrounded =
    testCase.hasLogo && spec.logoFree
      ? briefAskedForNoLogo(testCase.request.briefText, spec.logoFreeQuote)
      : null;

  return {
    id: testCase.id,
    palette: spec.palette,
    validHex,
    usesBrandColor,
    honorsNamedColor,
    contrastOk,
    logoPlaced,
    logoFreeCorrect,
    logoFreeGrounded,
  };
}

export interface DesignSpecTotals {
  validHex: number;
  brandColorUse: number;
  contrastOk: number;
  logoPlaced: number;
  logoFree: number;
  logoFreeGrounded: number;
  namedColorMisses: string[];
}

function share(values: boolean[]): number {
  if (values.length === 0) return 1;
  return values.filter(Boolean).length / values.length;
}

export function aggregateDesignSpec(
  scores: DesignSpecCaseScore[],
): DesignSpecTotals {
  return {
    validHex: share(scores.map((s) => s.validHex)),
    brandColorUse: share(
      scores
        .map((s) => s.usesBrandColor)
        .filter((v): v is boolean => v !== null),
    ),
    contrastOk: share(scores.map((s) => s.contrastOk)),
    logoPlaced: share(
      scores.map((s) => s.logoPlaced).filter((v): v is boolean => v !== null),
    ),
    logoFree: share(
      scores
        .map((s) => s.logoFreeCorrect)
        .filter((v): v is boolean => v !== null),
    ),
    logoFreeGrounded: share(
      scores
        .map((s) => s.logoFreeGrounded)
        .filter((v): v is boolean => v !== null),
    ),
    namedColorMisses: scores
      .filter((s) => s.honorsNamedColor === false)
      .map((s) => s.id),
  };
}

export function designSpecPassed(
  totals: DesignSpecTotals,
  thresholds: {
    minValidHex: number;
    minBrandColorUse: number;
    minContrastOk: number;
    minLogoPlaced: number;
    minLogoFree: number;
    minLogoFreeGrounded: number;
  },
): boolean {
  return (
    totals.validHex >= thresholds.minValidHex &&
    totals.brandColorUse >= thresholds.minBrandColorUse &&
    totals.contrastOk >= thresholds.minContrastOk &&
    totals.logoPlaced >= thresholds.minLogoPlaced &&
    totals.logoFree >= thresholds.minLogoFree &&
    totals.logoFreeGrounded >= thresholds.minLogoFreeGrounded &&
    totals.namedColorMisses.length === 0
  );
}
