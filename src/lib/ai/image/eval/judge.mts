import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

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
  const ask =
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

  const { stdout } = await run(
    "claude",
    ["-p", ask, "--allowedTools", "Read"],
    { timeout: 240_000, maxBuffer: 1024 * 1024 },
  );

  const cleaned = stdout
    .trim()
    .replace(/^```(?:json)?|```$/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Judge returned no JSON: ${stdout.slice(0, 200)}`);
  }
  return JSON.parse(cleaned.slice(start, end + 1)) as JudgeVerdict;
}
