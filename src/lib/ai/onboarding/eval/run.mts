/**
 * Periodic eval for conversational brand extraction.
 *
 * Paid lane: every case is a real Bedrock generateObject call, so a run costs
 * roughly cases x one short structured completion. Not for CI on every commit
 * -- run before shipping a change to the prompt, the schema or the model, and
 * nightly.
 *
 * Scoring is deliberately deterministic (see ./score.ts). Whether a field was
 * filled, and whether its value carries the transcript's factual anchor, both
 * have one correct answer, so neither is asked of a judge. Only the extraction
 * itself is non-deterministic.
 *
 * Usage: pnpm eval:onboarding [--case <id>]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}
// A stale bearer token hijacks auth from the valid SigV4 keys and fails every
// call with "Forbidden".
process.env.AWS_BEARER_TOKEN_BEDROCK = "";

const { generateObject } = await import("ai");
const { getModel } = await import("../../provider");
const {
  EXTRACTION_OUTPUT_TOKEN_CAP,
  extractionSchema,
  omitUnfilled,
  SYSTEM_PROMPT,
} = await import("../extraction");
const { EXTRACTION_EVAL_CASES, EXTRACTION_EVAL_THRESHOLDS } = await import(
  "./cases"
);
const { aggregate, casePassed, scoreCase } = await import("./score");

const args = process.argv.slice(2);
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;
const cases = only
  ? EXTRACTION_EVAL_CASES.filter((c) => c.id === only)
  : EXTRACTION_EVAL_CASES;

if (cases.length === 0) {
  console.error(only ? `No case named "${only}"` : "No cases defined");
  process.exit(1);
}

const scores = [];
for (const evalCase of cases) {
  process.stdout.write(`${evalCase.id} … `);
  const started = Date.now();
  try {
    const { object } = await generateObject({
      model: getModel("brand"),
      schema: extractionSchema,
      system: SYSTEM_PROMPT,
      prompt: evalCase.transcript,
      maxOutputTokens: EXTRACTION_OUTPUT_TOKEN_CAP,
    });
    const fields = omitUnfilled(object.fields);
    const score = scoreCase(evalCase, fields);
    scores.push(score);
    const pass = casePassed(score, EXTRACTION_EVAL_THRESHOLDS);
    console.log(
      `${pass ? "PASS" : "FAIL"} recall=${score.recall.toFixed(2)} ` +
        `value=${score.valueAccuracy.toFixed(2)} ` +
        `invented=${score.invented.length} (${Date.now() - started}ms)`,
    );
    if (score.missed.length)
      console.log(`   missed: ${score.missed.join(", ")}`);
    if (score.wrongValue.length)
      console.log(`   wrong value: ${score.wrongValue.join(", ")}`);
    if (score.invented.length)
      console.log(`   invented: ${score.invented.join(", ")}`);
  } catch (error) {
    console.log(`ERROR ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

const totals = aggregate(scores);
const failed = scores.filter((s) => !casePassed(s, EXTRACTION_EVAL_THRESHOLDS));

console.log("\n--- totals ---");
console.log(
  `recall ${totals.recall.toFixed(2)} (min ${EXTRACTION_EVAL_THRESHOLDS.minRecall})`,
);
console.log(
  `value accuracy ${totals.valueAccuracy.toFixed(2)} (min ${EXTRACTION_EVAL_THRESHOLDS.minValueAccuracy})`,
);
console.log(`invented fields ${totals.invented} across ${scores.length} cases`);
console.log(`${scores.length - failed.length}/${scores.length} cases passed`);

mkdirSync("qa-reports/eval", { recursive: true });
const reportPath = "qa-reports/eval/onboarding-extraction.json";
writeFileSync(
  reportPath,
  `${JSON.stringify({ totals, scores, thresholds: EXTRACTION_EVAL_THRESHOLDS }, null, 2)}\n`,
);
console.log(`report: ${reportPath}`);

if (failed.length > 0) process.exitCode = 1;
