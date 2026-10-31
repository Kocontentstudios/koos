import { generateObject } from "ai";
import { z } from "zod";
import type { BrandSummary } from "@/lib/ai/prompts/strategy";
import { getModel } from "@/lib/ai/provider";

/**
 * A reading of every piece of copy and every reason against the brief, by a
 * language model, for what no pattern can see.
 *
 * inventedFacts (claims.ts) catches the shapes a fact takes: a number, a day,
 * a price qualifier, a claim word. The model also writes claims with none of
 * those shapes: "Still warm at 7am" on a cold cream pastry, "gone by
 * morning", "designing for Lagos's climate", "just show up" on a brief that
 * says to book, "[REGISTRATION LINK]", "Leads with the croissant" on a
 * mille-feuille brief, copy in another language the English checks cannot
 * read. Round 3's eval judge found one in four directions carried one, and
 * the delivered lane, gated only by patterns, read zero (round-3 live
 * critic). One call per job reads them all; what it flags is rewritten by
 * its own suggestion when that passes the deterministic checks, or left off.
 *
 * Fail-soft like the judge: an unavailable check costs this reading, never
 * the design.
 */

export interface ClaimCheckField {
  /** "0.headline", "1.rationale.2": where the text sits. */
  id: string;
  /** What the text is, in words, for the reader. */
  field: string;
  text: string;
  /** The character limit a rewrite must keep to. */
  limit: number;
}

export interface UnsupportedClaim {
  id: string;
  /** The words that state what the brief does not. */
  statement: string;
  /** The field rewritten without it, or "" when nothing of it can stay. */
  rewrite: string;
}

export type ClaimChecker = (input: {
  fields: ClaimCheckField[];
  briefText: string;
  title: string;
  brand: BrandSummary;
}) => Promise<UnsupportedClaim[] | null>;

const responseSchema = z.object({
  unsupported: z
    .array(
      z.object({
        id: z.string(),
        statement: z.string().max(200),
        rewrite: z.string().max(400),
      }),
    )
    .max(40),
});

function profileLines(brand: BrandSummary): string {
  return [
    ["Name", brand.name],
    ["What it is", brand.overview],
    ["Business", brand.businessType],
    ["Offer", brand.offer],
    ["Audience", brand.targetAudience],
    ["What sets it apart", brand.differentiators],
    ["Values", brand.values],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

/* Every design's copy is read in one call, so a flagged headline's nearest
   supported line is often its sibling's headline, and the check offers it
   as the rewrite: at ba7a7ea all four refused headlines were rewritten as
   the other design's headline, which applyClaimCheck refuses, and each
   direction fell to recovery. Said here, before the fields are listed. */
function separateDesigns(fields: ClaimCheckField[]): string | null {
  const headlines = fields.filter((f) => /^\d+\.headline$/.test(f.id));
  if (headlines.length < 2) return null;
  return `The fields belong to ${headlines.length} separate designs, numbered by the first part of each id. Each design keeps its own idea, so a rewrite never uses another design's headline or says it again in other words: ${headlines
    .map((f) => `design ${f.id.split(".")[0]}'s headline is "${f.text}"`)
    .join(
      ", ",
    )}. When a headline is flagged, rewrite it from this design's own idea in words the brief supports, or return "" when nothing of it can stay.`;
}

export function buildClaimCheckPrompt({
  fields,
  briefText,
  title,
  brand,
}: Parameters<ClaimChecker>[0]): string {
  return [
    "You check marketing copy for a small business before it is published. Every statement must be something the brief or the brand profile below actually says. You are not judging style.",
    `The brief: ${briefText}`,
    title ? `Its title: ${title}` : null,
    `The brand profile:\n${profileLines(brand)}`,
    `Flag a field when it states, implies or promises anything the brief and profile do not: a product, ingredient or item they do not name; a temperature, freshness, texture or taste ("still warm", "fresh from the oven") they do not give; availability or scarcity ("gone by morning", "selling fast", "limited"); a time, day, date, price, discount, quantity, size, age or place they do not give, or one changed ("from" a price, "before" a time); a ranking, award, guarantee, delivery or free item; a person, speaker or credential, or a role, title or topic added to a person the brief names (a role the brief does not give them, or "on Building for Heat" when Building for Heat is the panel's name, not their topic); a method, process, origin or material the brief itself does not state in those terms ("hand-woven" or "woven by hand" for "woven by one artisan", "locally sourced", "organic", "natural"): a near-synonym is a different claim, and the profile's general description does not license it for this offer; a scale, reach or ambition the brief does not state ("Africa's payments future", "continent-wide", "for every business", "the future of"); an instruction that contradicts the brief ("just show up" when it says to book); a placeholder ("[LINK]", "TBC", "your name here"); any copy not written in English; a fact reworded so its scope or meaning changes ("first month free" for "zero transfer fees for your first month", "shared meals" for "all meals included", "one origin" for "single-origin", "on Building for Heat" when that is the panel's name, not its topic). A reason ("why this works") is also flagged when it says the design's copy holds something the copy listed for that direction does not hold.
Do not flag: an invitation or tone ("Treat yourself", "Come say hello"), a restatement of what the brief says in other words, the brand's own name, or anything the brief itself says in the same words. Before flagging a word, look for it in the brief: a role, material, count or condition the brief gives ("with architect Ada Obi", "linen", "10 seats", "limited seats") is supported (round-7 eval: each of these was flagged on copy that quoted the brief).`,
    separateDesigns(fields),
    `The fields, one per line as id | what it is | text:\n${fields
      .map((f) => `${f.id} | ${f.field} | ${f.text}`)
      .join("\n")}`,
    'Return "unsupported": one entry per flagged field with its id, the exact words that are unsupported, and "rewrite": the whole field rewritten to do the same job with only what the brief and profile say, within its character limit (headline 70, subheadline 140, button 32, footer line 60, reason 90), or "" when nothing of it can stay. Return an empty list when every field holds.',
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const checkClaims: ClaimChecker = async (input) => {
  if (input.fields.length === 0) return [];
  try {
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema: responseSchema,
      maxOutputTokens: 3000,
      prompt: buildClaimCheckPrompt(input),
    });
    const known = new Set(input.fields.map((f) => f.id));
    const unsupported = (object as { unsupported?: unknown }).unsupported;
    if (!Array.isArray(unsupported)) return null;
    return unsupported.filter(
      (claim): claim is UnsupportedClaim =>
        typeof claim?.id === "string" && known.has(claim.id),
    );
  } catch (err) {
    console.error(
      "claim check unavailable; delivering on the pattern checks",
      err,
    );
    return null;
  }
};
