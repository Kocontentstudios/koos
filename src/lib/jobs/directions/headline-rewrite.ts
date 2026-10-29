import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/provider";
import { distinctiveWords } from "./text-overlap";

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
/* The rewrite asks for three; up to five were accepted when the schema
   capped the array, and still are. */
const REWRITTEN_HEADLINES_KEPT = 5;

/* Lenient on purpose: a sixth headline or one over-long is the model's
   answer, not an outage. Capped in the schema, either failed the whole call
   and the direction was lost as "the headline model could not be reached"
   (round-14 code critic, finding 4); the caller keeps the first few and
   refuses an over-long one by name. */
const schema = z.object({
  headlines: z.array(z.string()),
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
      .filter((h) => h.length > 0 && h.length <= REWRITTEN_HEADLINE_MAX)
      .slice(0, REWRITTEN_HEADLINES_KEPT);
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

/* Five, not three: every candidate goes to the one claim check in a single
   call, so more of them cost no extra call. At ba7a7ea two lost directions
   had all three candidates refused because the subheadline repeated each,
   and a fourth or fifth idea is the only other chance the one ask has. */
export const RECOVERED_HEADLINES_ASKED = 5;

export function buildHeadlineRecoveryPrompt(input: HeadlineRecoveryInput) {
  /* Numbers are covered by the rule's own clause; listed, "₦38,000" reads
     as "38, 000". */
  const subheadlineWords = distinctiveWords(input.subheadline).filter(
    (word) => !/^\d+$/.test(word),
  );
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
    /* The rule the job holds a headline to, stated as the job applies it
       (aboveRepeatsBy): at ba7a7ea "Pre-order the Harmattan dress" over
       "The Harmattan linen dress. ₦38,000. Pre-orders open 1 November." and
       "The Shop Reopens This Saturday" over "Iya Basira Fabrics reopens
       Saturday 6 December" were refused by it, as were seven more of nine. */
    subheadlineWords.length > 0
      ? `The subheadline already uses these words: ${subheadlineWords.join(", ")}. A headline is refused when two of every three of its words are among them, or when it gives a number, date, time or price the subheadline gives. Build each headline mostly from other words: the moment, the feeling, the use or the reason to come.`
      : null,
    `Write ${RECOVERED_HEADLINES_ASKED} headlines for this design, best first, each a different idea, keeping its idea where the brief supports it. Each at most ${REWRITTEN_HEADLINE_MAX} characters, in English, a phrase rather than a sentence, saying nothing the subheadline or button already says. State only what the brief says: no product, price, time, date, place, number, person, quality, method, origin, scale or promise it does not give, and nothing the refusal names.`,
    `Return "headlines": the ${RECOVERED_HEADLINES_ASKED}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The first RECOVERED_HEADLINES_ASKED headlines the model wrote,
 *  trimmed: the job holds each to the length limit with the other rules,
 *  so the trace names why each went ("length"). */
export const recoverHeadline: HeadlineRecoverer = async (input) => {
  try {
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema,
      maxOutputTokens: 600,
      prompt: buildHeadlineRecoveryPrompt(input),
    });
    const headlines = (object as { headlines?: unknown }).headlines;
    if (!Array.isArray(headlines)) return null;
    return headlines
      .filter((h): h is string => typeof h === "string")
      .map((h) => h.replace(/\s+/g, " ").trim())
      .filter((h) => h.length > 0)
      .slice(0, RECOVERED_HEADLINES_ASKED);
  } catch (err) {
    console.error("headline recovery unavailable; the direction fails", err);
    return null;
  }
};
