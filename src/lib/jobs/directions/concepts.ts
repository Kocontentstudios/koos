import {
  type DesignCategory,
  playbook,
} from "@/lib/ai/design-training/playbooks";
import type { DesignSpec } from "@/lib/design/spec";
import { clampText } from "./finalize";
import { DIRECTION_REASON_MAX } from "./schema";

/**
 * The two concepts a pair of directions is built on.
 *
 * Asking a model for "two different directions" gets one idea drawn twice:
 * the same headline reworded, the same scene relit. Difference has to be
 * designed in, so each direction is handed its own lens before any copy is
 * written: what it leads with, and how it makes the case. The leads come from
 * the category's playbook priority order (module 08), which is the ranked
 * list of things this kind of post can be about, so both concepts are ones
 * the playbook already endorses for the brief and neither is invented.
 *
 *  - "show" leads with the first priority and lets the image carry it. The
 *    copy names what is shown.
 *  - "say" leads with the next real priority and lets the words carry it: a
 *    line in the brand's voice that would work without the picture.
 *  - "angle" is for regenerating one direction: a third lead neither of the
 *    first two took.
 */

export type LensId = "show" | "say" | "angle";

export interface ConceptLens {
  id: LensId;
  /** The playbook priority this direction leads with. */
  lead: string;
  instruction: string;
  /** Layouts that suit how this lens makes its case, best first. A hint to
   *  the model only; distinctness is enforced in code (layouts.ts). */
  suits: readonly DesignSpec["layout"][];
}

/* Priority entries that are an action or utility detail rather than a thing
   a design can be about. Leading with "CTA" is not a concept. */
const NOT_A_LEAD =
  /\b(cta|contact|utility|download|access|sponsor|deadline|date|time|optional)\b/i;

function leadsFor(category: DesignCategory): string[] {
  const leads = playbook(category).priority.filter((p) => !NOT_A_LEAD.test(p));
  return leads.length > 0 ? leads : ["the offer"];
}

function show(category: DesignCategory, lead: string): ConceptLens {
  return {
    id: "show",
    lead,
    instruction: `Lead with ${lead}. Let the image carry the message: the headline names what the picture shows in plain, concrete words, and the composition gives the subject room. ${playbook(category).composition}`,
    suits: ["hero-center", "split-left", "banner-bottom"],
  };
}

function say(lead: string): ConceptLens {
  return {
    id: "say",
    lead,
    instruction: `Lead with ${lead}. Let the words carry the message: a line in the brand's own voice about what the customer gets or feels, strong enough to work without the picture. Typography is the hero; the image supports it.`,
    suits: ["quote-card", "stat-highlight", "hero-center"],
  };
}

function angle(lead: string): ConceptLens {
  return {
    id: "angle",
    lead,
    instruction: `Lead with ${lead}, an angle neither existing direction took. Change the register too: if they were literal, be expressive; if they were expressive, be direct and factual.`,
    suits: ["banner-bottom", "stat-highlight", "split-left"],
  };
}

export function planConcepts(
  category: DesignCategory,
): [ConceptLens, ConceptLens] {
  const leads = leadsFor(category);
  return [show(category, leads[0]), say(leads[1] ?? leads[0])];
}

/** The lens for one regenerated direction: the first lead after the two the
 *  pair used, falling back to the pair's second lead in a new register. */
export function regenerationConcept(category: DesignCategory): ConceptLens {
  const leads = leadsFor(category);
  return angle(leads[2] ?? leads[1] ?? leads[0]);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Reasons that are true by construction, for a draft that came back with
 * fewer than two usable ones. They name the lens and the playbook, so they
 * stay grounded rather than becoming the filler finalizeDirection removes.
 */
export function lensReasons(
  lens: ConceptLens,
  category: DesignCategory,
): string[] {
  const reasons = [
    `${capitalise(lens.lead)} leads, the first thing a ${category} post has to land`,
    lens.id === "say"
      ? "The headline carries the message, so it reads even as a thumbnail"
      : "The image does the selling and the copy names what it shows",
  ];
  return reasons.map((r) => clampText(r, DIRECTION_REASON_MAX));
}
