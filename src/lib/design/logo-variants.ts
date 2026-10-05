/**
 * The order the renderer should try a brand's marks in.
 *
 * A brand rarely has one logo: a stacked mark, a horizontal lockup, an icon,
 * and light and dark cuts of each. Nothing in the product could store a second
 * one, so `loadBestLogo` — which already picks by MEASURING contrast against
 * the background — has always had exactly one candidate (FEAT-032).
 *
 * Measurement stays in charge: a label is a claim and "logo-white.png" is a
 * convention, while the probe is evidence. This only decides what measurement
 * cannot. `loadBestLogo` keeps the first candidate when contrast ties, so
 * ordering IS the tiebreak: between two marks that both read perfectly well,
 * the one the user chose as their default should win rather than whichever
 * happened to be uploaded first.
 *
 * Pure and order-stable: a design set is judged as a set, so the same brand
 * and the same background must always produce the same mark.
 */

export type LogoBackground = "any" | "light" | "dark";

export interface LogoVariation {
  fileUrl: string;
  logoVariant: string | null;
  logoBackground: LogoBackground;
  label: string | null;
  isPreferred: boolean;
}

/* Lower sorts first. The user's default leads; a cut declared for a specific
   background follows, because declaring one is a weak signal that it is the
   considered artwork rather than a stray upload. */
function rank(variation: LogoVariation): number {
  if (variation.isPreferred) return 0;
  return variation.logoBackground === "any" ? 2 : 1;
}

export function orderLogoCandidates(
  variations: LogoVariation[],
  primaryLogoUrl: string | null | undefined,
): string[] {
  const ordered = [...variations]
    .filter((variation) => variation.fileUrl.trim().length > 0)
    .sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      /* Stable across runs without depending on the array's arrival order. */
      return a.fileUrl.localeCompare(b.fileUrl);
    })
    .map((variation) => variation.fileUrl);

  /* The profile logo is still the brand's primary mark, so it leads unless a
     variation has been explicitly made the default. */
  const primary = primaryLogoUrl?.trim();
  if (!primary) return ordered;

  const preferredVariation = variations.some((v) => v.isPreferred);
  const withoutPrimary = ordered.filter((url) => url !== primary);
  return preferredVariation
    ? [...ordered.filter((url) => url !== primary), primary].filter(
        (url, i, all) => all.indexOf(url) === i,
      )
    : [primary, ...withoutPrimary];
}
