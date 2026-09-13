/**
 * The judge is a CLI, so its answer arrives as whatever the model felt like
 * printing. Pulling the JSON out of that is pure string work with one right
 * answer, so it lives here where the free gate lane can cover it rather than
 * inside the paid runner where it is only exercised by spending money.
 */
export function parseJudgeJson<T>(stdout: string): T {
  const cleaned = stdout
    .trim()
    .replace(/^```(?:json)?|```$/g, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Judge returned no JSON: ${stdout.slice(0, 200)}`);
  }
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}
