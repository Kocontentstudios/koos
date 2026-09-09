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

  return {
    id: testCase.id,
    palette: spec.palette,
    validHex,
    usesBrandColor,
    honorsNamedColor,
    contrastOk,
  };
}

export interface DesignSpecTotals {
  validHex: number;
  brandColorUse: number;
  contrastOk: number;
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
  },
): boolean {
  return (
    totals.validHex >= thresholds.minValidHex &&
    totals.brandColorUse >= thresholds.minBrandColorUse &&
    totals.contrastOk >= thresholds.minContrastOk &&
    totals.namedColorMisses.length === 0
  );
}
