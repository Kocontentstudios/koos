import type { DesignContext } from "@/lib/design/context";
import { brandFacts } from "@/lib/jobs/directions/brief";
import {
  type BriefFact,
  drawnText,
  withVenueOrBrand,
} from "@/lib/jobs/directions/brief-facts";
import { coverFactsOf } from "@/lib/jobs/directions/brief-read";
import {
  type FactLedger,
  factLedger,
  inventedFacts,
} from "@/lib/jobs/directions/claims";
import { commercialClaims } from "./commercial";
import type { FrameBeat } from "./contract";
import { profileStatements } from "./points";
import { frameCopy } from "./validate";

/** The facts a set is held to, read exactly as draftDirections reads them
 *  (brief.ts): a venue the brief calls "our Yaba bar" is stated by the
 *  brand's name and the area, as a single design's would be. */
export function sequenceFacts(
  read: Parameters<typeof coverFactsOf>[0],
  brandName: string,
): BriefFact[] {
  return withVenueOrBrand(coverFactsOf(read), brandName);
}

/**
 * What the brief and brand vouch for. Unlike a single design's ledger, the
 * profile's statements (profileStatements) license what the brief does: a
 * thin brief's frame makes a profile point by decision (Oluwaseyi,
 * 2026-10-30), so a claim taken word for word from the brand's
 * differentiators is sourced. The goal licenses nothing: it is what the
 * business wants, not what is true.
 */
export function sequenceLedger(
  context: DesignContext,
  memorySummary: string,
): FactLedger {
  const brand = context.brandSummary;
  const statements = profileStatements(brand);
  const goal = brand.primaryGoal?.trim();
  const rest = brandFacts(brand).filter(
    (source) =>
      source?.trim() !== goal && !statements.includes(source?.trim() ?? ""),
  );
  return factLedger(
    [context.briefText, context.title, ...statements, ...rest, memorySummary],
    2 + statements.length,
  );
}

/** Numbers, days, claims and commercial terms on a frame that neither the
 *  brief nor the brand gives. Not a contract rule: the fix call is asked
 *  to take them out, and the eval counts any that stay. */
export function inventedOn(beat: FrameBeat, ledger: FactLedger): string[] {
  const text = drawnText(frameCopy(beat));
  return [
    ...inventedFacts(text, ledger),
    ...commercialClaims(text, ledger.text),
  ];
}
