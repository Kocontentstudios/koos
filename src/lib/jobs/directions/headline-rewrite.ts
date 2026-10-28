import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/provider";

/**
 * New headlines for one direction of a pair that still says one idea twice,
 * written to a different idea the brief supports.
 *
 * The deterministic separation (brief.ts) can only reuse words already on
 * the page: the brief's title, its name for the offering, or a sentence
 * promoted from the subheadline. When every one of those shares the other
 * headline's words (round-6 eval, bakery-upload: "Strawberry Mille-Feuille"
 * beside "Order your strawberry mille-feuille from 7am.", where the title,
 * the offering and the subheadline all named the pastry), nothing on the
 * page can move them apart and a model has to find another angle. What it
 * writes is held by the caller to the same rules as any copy: limits, the
 * brief's facts, the near-duplicate rule and the claim check.
 */

export interface HeadlineRewriteInput {
  /** The direction whose headline moves. */
  headline: string;
  subheadline?: string;
  cta?: string;
  /** Every other direction's headline, which the new one must not echo. */
  others: string[];
  /** The words shared with them, to leave out. */
  avoid: string[];
  briefText: string;
  title: string;
}

export type HeadlineRewriter = (
  input: HeadlineRewriteInput,
) => Promise<string[] | null>;

/** Short enough to read as a headline, not a promoted sentence. */
export const REWRITTEN_HEADLINE_MAX = 40;

const schema = z.object({
  headlines: z.array(z.string().max(120)).max(5),
});

export function buildHeadlineRewritePrompt(input: HeadlineRewriteInput) {
  return [
    "You write headlines for a small business's social media design. Two designs for the same brief have headlines that say the same thing, so this one needs a headline built on a different idea.",
    `The brief: ${input.briefText}`,
    input.title ? `Its title: ${input.title}` : null,
    `This design's copy:\n  headline: ${input.headline}${
      input.subheadline ? `\n  subheadline: ${input.subheadline}` : ""
    }${input.cta ? `\n  button: ${input.cta}` : ""}`,
    `The other design's headline: ${input.others.join(" / ")}`,
    input.avoid.length > 0
      ? `Do not use these words: ${input.avoid.join(", ")}.`
      : null,
    `Write three headlines, each a different idea from the other design's headline: a moment, a feeling, a use or a reason to come that the brief supports. Each at most ${REWRITTEN_HEADLINE_MAX} characters, a phrase rather than a full sentence, in English. State nothing the brief does not: no new product, price, time, date, place, quality, method, origin, scale or promise. The subheadline and button stay as they are, so the headline need not carry the facts.`,
    'Return "headlines": the three, best first.',
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const rewriteHeadline: HeadlineRewriter = async (input) => {
  try {
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema,
      maxOutputTokens: 400,
      prompt: buildHeadlineRewritePrompt(input),
    });
    const headlines = (object as { headlines?: unknown }).headlines;
    if (!Array.isArray(headlines)) return null;
    return headlines
      .filter((h): h is string => typeof h === "string")
      .map((h) => h.replace(/\s+/g, " ").trim())
      .filter((h) => h.length > 0 && h.length <= REWRITTEN_HEADLINE_MAX);
  } catch (err) {
    console.error("headline rewrite unavailable; keeping the pair", err);
    return null;
  }
};

/**
 * One more headline for a direction whose headline was refused, before the
 * direction is declared lost (round-12: at a958ac0 conference-ko's second
 * direction lost "Can African cities beat the heat?" to the claim check,
 * whose rewrite was refused, and the case shipped one design). The model is
 * told what was refused and why, and to keep clear of the other design's
 * headline. Code never writes the headline: what comes back is held to
 * every rule a headline is, and to the claim check, by the caller.
 */
export interface HeadlineRecoveryInput {
  /** Each headline refused for this design, and why. */
  refused: { headline: string; why: string }[];
  subheadline?: string;
  cta?: string;
  /** The other designs' headlines, which the new one must not repeat. */
  others: string[];
  briefText: string;
  title: string;
}

export type HeadlineRecoverer = (
  input: HeadlineRecoveryInput,
) => Promise<string[] | null>;

export const HEADLINE_RECOVERY_PROMPT_START =
  "You write the headline for one design of a small business's social media post. Its headline was refused";

export function buildHeadlineRecoveryPrompt(input: HeadlineRecoveryInput) {
  return [
    `${HEADLINE_RECOVERY_PROMPT_START}, and without one the design cannot be shown.`,
    `The brief: ${input.briefText}`,
    input.title ? `Its title: ${input.title}` : null,
    `Refused:\n${input.refused
      .map((r) => `  "${r.headline}": ${r.why}`)
      .join("\n")}`,
    `This design's other copy, which stays as it is:${
      input.subheadline ? `\n  subheadline: ${input.subheadline}` : ""
    }${input.cta ? `\n  button: ${input.cta}` : ""}`,
    input.others.length > 0
      ? `The other design's headline, which this one must not repeat or echo: ${input.others.join(" / ")}`
      : null,
    `Write three headlines for this design, best first, keeping its idea where the brief supports it. Each at most ${REWRITTEN_HEADLINE_MAX} characters, in English, a phrase rather than a sentence, saying nothing the subheadline or button already says. State only what the brief says: no product, price, time, date, place, number, person, quality, method, origin, scale or promise it does not give, and nothing the refusal names.`,
    'Return "headlines": the three.',
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const recoverHeadline: HeadlineRecoverer = async (input) => {
  try {
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema,
      maxOutputTokens: 400,
      prompt: buildHeadlineRecoveryPrompt(input),
    });
    const headlines = (object as { headlines?: unknown }).headlines;
    if (!Array.isArray(headlines)) return null;
    return headlines
      .filter((h): h is string => typeof h === "string")
      .map((h) => h.replace(/\s+/g, " ").trim())
      .filter((h) => h.length > 0 && h.length <= REWRITTEN_HEADLINE_MAX);
  } catch (err) {
    console.error("headline recovery unavailable; the direction fails", err);
    return null;
  }
};
