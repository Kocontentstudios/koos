import { z } from "zod";
import type { PlannedSequence } from "@/lib/design/sequence/contract";
import type { SequenceEvalCase } from "./cases";
import type { JudgeScores } from "./score";

/**
 * The eval's latent lane: a harsh reader of the set's copy, in order, on
 * the three things code cannot measure. The planner's own model is the
 * judge (getModel("strategy"), the path every KO call takes), so the run
 * script sends it the frames and the brief only, never the planner's
 * prompts or reasoning.
 */

const WHY_MAX = 400;

const scored = z.object({
  why: z.string().max(WHY_MAX),
  score: z.number().int().min(1).max(5),
});

/* Per frame, so the eval can check every frame the judge scores low for
   repetition was flagged weak by code (rubric Addendum A, flag recall).
   After the set's scores in the answer, so it is read once they are
   given and does not lead them. */
const frameRepetition = z.object({
  frame: z.number().int().min(1).max(20),
  repetition: z.number().int().min(1).max(5),
});

export const judgeSchema = z.object({
  hook: scored,
  lastAction: scored,
  nonRepetitive: scored,
  frames: z.array(frameRepetition).max(20),
});

export type JudgeAnswer = z.infer<typeof judgeSchema>;

/**
 * A verdict whose reasons run past WHY_MAX, shortened so it parses: round
 * 2 lost the cafe run's whole verdict to one 520-character "why", and a
 * run the judge failed on is not counted, which skews the average toward
 * whichever runs it could score. Only the reasons are cut; a score is
 * never touched.
 */
export async function repairJudgeText({
  text,
}: {
  text: string;
}): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const answer = { ...(parsed as Record<string, unknown>) };
  let changed = false;
  for (const key of ["hook", "lastAction", "nonRepetitive"]) {
    const entry = answer[key] as { why?: unknown } | undefined;
    if (typeof entry?.why === "string" && entry.why.length > WHY_MAX) {
      answer[key] = { ...entry, why: `${entry.why.slice(0, WHY_MAX - 1)}…` };
      changed = true;
    }
  }
  return changed ? JSON.stringify(answer) : null;
}

export const JUDGE_SYSTEM =
  "You are a senior social media creative director reviewing a junior's work before it goes out. You are hard to impress: a 5 is work you would post unchanged and that would beat what Canva or Predis would produce for the same brief. Generic, safe or repetitive work scores 3 or less. Judge only what is written.";

function frameText(plan: PlannedSequence): string {
  const noun = plan.kind === "presentation" ? "Slide" : "Frame";
  return plan.frames
    .map((f, i) =>
      [
        `${noun} ${i + 1} of ${plan.frames.length}${f.showsImage ? " (with image)" : " (text only)"}`,
        `  headline: ${f.headline}`,
        f.subheadline ? `  subheadline: ${f.subheadline}` : null,
        f.footerLines.length > 0
          ? `  footer: ${f.footerLines.join(" | ")}`
          : null,
        f.cta ? `  button: ${f.cta}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

export function buildJudgePrompt(
  c: SequenceEvalCase,
  plan: PlannedSequence,
): string {
  return [
    `A ${plan.kind} of ${plan.frames.length} for ${c.brand.name} (${c.brand.overview ?? ""}), for ${c.brand.targetAudience ?? "its customers"}.`,
    `The brief: ${c.request.briefText}`,
    `The ${plan.kind}, in the order it is seen:\n\n${frameText(plan)}`,
    `Score each from 1 to 5, with one sentence of why:
- "hook": does the first frame earn the swipe? 5: names the offer and gives a concrete, specific reason to see more; 3: names it but is flat or generic; 1: unclear what it is about.
- "lastAction": does the last frame carry the action? 5: one clear action with how to take it (the contact, place or link the brief gives); 3: an action without the how, or a vague one; 1: no action.
- "nonRepetitive": does each frame move the story on? 5: every frame makes its own point in its own words, read in order it builds; 3: two frames say much the same or reuse phrasing; 1: one message cut into pieces.
Then "frames": one entry per frame, its number and "repetition" from 1 to 5: 5 makes a point no other frame makes, in its own words; 3 shares some of another frame's point or wording; 2 or less says what an earlier frame said, or adds nothing a reader needs.`,
  ].join("\n\n");
}

export function judgeScores(answer: JudgeAnswer): JudgeScores {
  return {
    hook: answer.hook.score,
    lastAction: answer.lastAction.score,
    nonRepetitive: answer.nonRepetitive.score,
  };
}
