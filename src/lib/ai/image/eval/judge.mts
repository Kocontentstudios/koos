import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseJudgeJson } from "./judge-parse.js";

const run = promisify(execFile);

/**
 * Asks the judge, and asks once more if the CLI itself fell over.
 *
 * A transient invocation failure — a timeout, a rate limit, a dropped
 * connection — is not the image failing the criterion, but scoring it as one
 * makes the whole lane untrustworthy: a run that "fails" for reasons unrelated
 * to the design teaches you to ignore the lane. A genuinely bad answer still
 * fails, because parseJudgeJson throws on prose and that is not retried
 * differently — it is the same call made twice.
 */
const JUDGE_ARGS = ["--allowedTools", "Read"];

/** Thrown when the judge could not be RUN, as opposed to answering badly. */
export class JudgeUnavailableError extends Error {}

function unavailable(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "ENOENT" || code === "EACCES";
}

async function ask<T>(prompt: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { stdout } = await run("claude", ["-p", prompt, ...JUDGE_ARGS], {
        timeout: 240_000,
        maxBuffer: 1024 * 1024,
      });
      return parseJudgeJson<T>(stdout);
    } catch (err) {
      /* Not on PATH, or not executable. Retrying changes nothing, and scoring
         it as a content failure is how a lane becomes one you learn to
         ignore — the design was never looked at. */
      if (unavailable(err)) {
        throw new JudgeUnavailableError(
          "the `claude` CLI could not be run, so no image was judged",
        );
      }
      lastError = err;
    }
  }
  throw lastError;
}

export interface JudgeVerdict {
  textFound: string;
  legible: boolean;
  spelledCorrectly: boolean;
  notes: string;
}

/**
 * Scores rendered copy with the local Claude Code CLI rather than a hosted
 * vision API, per the project's LLM-access rule. Reading pixels is a judgement
 * call; everything the eval can settle by arithmetic is handled in run.mts
 * instead so the judge is only asked what it is actually needed for.
 */
export async function judgeImage(
  imagePath: string,
  expectedText: string | null,
): Promise<JudgeVerdict> {
  const question =
    expectedText === null
      ? `Read the image at ${imagePath}. It is meant to be a purely abstract ` +
        `background with NO text. Reply with ONLY compact JSON: ` +
        `{"textFound":"<any lettering you can see, empty string if none>",` +
        `"legible":false,"spelledCorrectly":true,"notes":"<one short phrase>"}`
      : `Read the image at ${imagePath}. It should display exactly the text ` +
        `"${expectedText}". Reply with ONLY compact JSON: ` +
        `{"textFound":"<exact text visible>","legible":<true if the text is ` +
        `sharp and readable>,"spelledCorrectly":<true if it matches ` +
        `"${expectedText}" exactly>,"notes":"<one short phrase>"}`;

  return ask<JudgeVerdict>(question);
}

export interface LogoVerdict {
  /** How many distinct logo-like marks are visible. More than one means the
   * image model drew its own alongside the one we composited. */
  logoCount: number;
  /** Which corner the mark sits in, or "" when there is none. */
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "";
  distorted: boolean;
  overlapsText: boolean;
  notes: string;
}

/**
 * Whether the brand's mark actually survived to the finished design.
 *
 * This is the one question the arithmetic in run.mts cannot answer: the logo
 * can be absent, doubled, squashed or sitting on the headline, and every one
 * of those returns a perfectly valid PNG of the right size (KOOS-BUG-022).
 */
export async function judgeLogo(
  imagePath: string,
  expectLogo: boolean,
): Promise<LogoVerdict> {
  const question = expectLogo
    ? `Read the image at ${imagePath}. It is a social media design that ` +
      `should carry exactly ONE brand logo, placed in a corner. Ignore the ` +
      `headline and body copy — judge only the logo mark. Reply with ONLY ` +
      `compact JSON: {"logoCount":<number of distinct logo marks>,` +
      `"corner":"<top-left|top-right|bottom-left|bottom-right, or empty ` +
      `string if no logo>","distorted":<true if the mark looks stretched, ` +
      `squashed or cropped>,"overlapsText":<true if the mark sits on top of ` +
      `any text>,"notes":"<one short phrase>"}`
    : `Read the image at ${imagePath}. It is a social media design that ` +
      `should carry NO brand logo at all. Reply with ONLY compact JSON: ` +
      `{"logoCount":<number of distinct logo marks you can see>,"corner":"",` +
      `"distorted":false,"overlapsText":false,"notes":"<one short phrase>"}`;

  return ask<LogoVerdict>(question);
}
