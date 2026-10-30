import { DRAFT_LIMITS } from "@/lib/jobs/directions/schema";
import { ANGLE_MAX, SCENE_MAX } from "./schema";

/**
 * Rescues a planner answer that is complete but malformed, so the user gets
 * their set instead of "The AI returned an unusable response". The AI SDK
 * calls this only after the answer failed to parse or validate, and the
 * schema is checked again on what it returns.
 *
 * Shapes seen on the real model, as in the directions answer
 * (directions/repair.ts):
 *  - every enum quoted twice: "logoPlacement": "\"top-left\"", and the
 *    empty logo quote as "\"\"";
 *  - `frames` (or `footerLines`, `spare`, `otherHooks`) as a JSON string
 *    holding the array;
 *  - a text field past its parse limit, shortened at a word boundary only so
 *    the answer parses: the fault check then names it and the fix call has
 *    it rewritten, so a cut clause is never drawn without the model asked;
 *  - one frame too many, a closing frame written twice: the first frames
 *    and the last are kept, since the last is the action.
 * Anything else (a missing field, too few frames, an off-list enum) is left
 * to fail, because inventing a value is worse than asking again.
 */

const TEXT_LIMITS: Record<string, number> = {
  title: DRAFT_LIMITS.title,
  headline: DRAFT_LIMITS.headline,
  subheadline: DRAFT_LIMITS.subheadline,
  cta: DRAFT_LIMITS.cta,
  backgroundPrompt: SCENE_MAX,
};

const QUOTED = /^\s*"([\s\S]*)"\s*$/;

/* Only fields that are never copy are unquoted: a headline the model set in
   quotation marks keeps them. */
const ANSWER_ENUMS = [
  "logoPlacement",
  "backgroundTreatment",
  "footerStyle",
] as const;
const FRAME_ENUMS = ["layout"] as const;

function unquoted(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const match = QUOTED.exec(value);
  return match ? match[1] : value;
}

function clampWords(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1).lastIndexOf(" ");
  return clean.slice(0, cut > 0 ? cut : max).trim();
}

function parsedArray(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    const inner = JSON.parse(value);
    return Array.isArray(inner) ? inner : value;
  } catch {
    return value;
  }
}

function asBoolean(value: unknown): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function repairedFrame(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const frame = { ...(value as Record<string, unknown>) };
  for (const key of FRAME_ENUMS) {
    if (key in frame) frame[key] = unquoted(frame[key]);
  }
  for (const [field, max] of Object.entries(TEXT_LIMITS)) {
    const text = frame[field];
    if (typeof text === "string" && text.length > max) {
      frame[field] = clampWords(text, max);
    }
  }
  if ("footerLines" in frame) {
    frame.footerLines = parsedArray(frame.footerLines);
    if (frame.footerLines === null) frame.footerLines = [];
    if (Array.isArray(frame.footerLines)) {
      frame.footerLines = frame.footerLines
        .slice(0, DRAFT_LIMITS.footerLines)
        .map((line) =>
          typeof line === "string"
            ? clampWords(line, DRAFT_LIMITS.footerLine)
            : line,
        );
    }
  }
  if ("showsImage" in frame) frame.showsImage = asBoolean(frame.showsImage);
  if ("point" in frame) {
    const cited = Number(frame.point);
    frame.point = Number.isInteger(cited) ? cited : 0;
  }
  return frame;
}

/** The first `count - 1` frames and the last, when one too many came. */
function counted(frames: unknown[], count: number | undefined): unknown[] {
  if (count === undefined || frames.length <= count || count < 1) {
    return frames;
  }
  return [...frames.slice(0, count - 1), frames[frames.length - 1]];
}

export async function repairSequenceText({
  text,
  count,
}: {
  text: string;
  /** How many frames were asked for; undefined for a rewrite answer,
   *  which lists only the frames it was asked to fix. */
  count?: number;
}): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const answer = { ...(parsed as Record<string, unknown>) };
  for (const key of ANSWER_ENUMS) {
    if (key in answer) answer[key] = unquoted(answer[key]);
  }
  if (answer.logoFreeQuote === '""') answer.logoFreeQuote = "";
  if ("logoFree" in answer) answer.logoFree = asBoolean(answer.logoFree);
  if (typeof answer.cta === "string" && answer.cta.length > DRAFT_LIMITS.cta) {
    answer.cta = clampWords(answer.cta, DRAFT_LIMITS.cta);
  }
  if (
    typeof answer.hookAngle === "string" &&
    answer.hookAngle.length > ANGLE_MAX
  ) {
    answer.hookAngle = clampWords(answer.hookAngle, ANGLE_MAX);
  }
  if ("kinds" in answer) {
    answer.kinds = parsedArray(answer.kinds);
    if (answer.kinds === null) answer.kinds = [];
    if (Array.isArray(answer.kinds)) answer.kinds = answer.kinds.map(unquoted);
  }
  if ("sameAs" in answer) {
    answer.sameAs = parsedArray(answer.sameAs);
    if (answer.sameAs === null) answer.sameAs = [];
  }
  if ("spare" in answer) {
    answer.spare = parsedArray(answer.spare);
    if (answer.spare === null) answer.spare = [];
  }
  if ("otherHooks" in answer) {
    answer.otherHooks = parsedArray(answer.otherHooks);
    if (answer.otherHooks === null) answer.otherHooks = [];
    if (Array.isArray(answer.otherHooks)) {
      answer.otherHooks = answer.otherHooks.map(repairedFrame);
    }
  }
  answer.frames = parsedArray(answer.frames);
  if (Array.isArray(answer.frames)) {
    answer.frames = counted(answer.frames, count).map(repairedFrame);
  }
  const repaired = JSON.stringify(answer);
  return repaired === JSON.stringify(parsed) ? null : repaired;
}

/** repairSequenceText for a call that asked for `count` frames. */
export function repairSequenceFor(count?: number) {
  return ({ text }: { text: string }) => repairSequenceText({ text, count });
}
