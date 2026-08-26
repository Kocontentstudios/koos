/**
 * Periodic eval for campaign strategy generation.
 *
 * Paid lane: every case is a real generateObject call, so a run costs roughly
 * cases x one structured completion. Not for CI on every commit — run before
 * shipping a change to the strategy prompt, the schema or the model, and
 * nightly.
 *
 * Scoring is deliberately deterministic (see ./score.ts). Whether a campaign
 * name carries the chat's topic, and whether it carries a topic the user set
 * aside, both have one correct answer, so neither is asked of a judge. Only
 * the generation itself is non-deterministic.
 *
 * Usage: pnpm eval:strategy [--case <id>]
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
const { strategySchema } = await import("../../strategy-schema");
const { buildStrategistSystemPrompt, buildStrategyGenerationPrompt } =
  await import("../../prompts/strategy");
const { STRATEGY_EVAL_CASES, STRATEGY_EVAL_THRESHOLDS } = await import(
  "./cases"
);
const { aggregateStrategy, scoreStrategyCase, strategyCasePassed } =
  await import("./score");

/** Bedrock's 4096 default truncates a full strategy into malformed JSON. */
const STRATEGY_OUTPUT_TOKEN_CAP = 8000;

const args = process.argv.slice(2);
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;
const cases = only
  ? STRATEGY_EVAL_CASES.filter((c) => c.id === only)
  : STRATEGY_EVAL_CASES;

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
      model: getModel("strategy"),
      schema: strategySchema,
      system: buildStrategistSystemPrompt(evalCase.brand),
      prompt: buildStrategyGenerationPrompt(
        evalCase.transcript,
        evalCase.brand,
      ),
      maxOutputTokens: STRATEGY_OUTPUT_TOKEN_CAP,
    });
    const score = scoreStrategyCase(
      evalCase,
      object,
      STRATEGY_EVAL_THRESHOLDS.maxNameLength,
    );
    scores.push(score);
    const pass = strategyCasePassed(score, STRATEGY_EVAL_THRESHOLDS);
    console.log(
      `${pass ? "PASS" : "FAIL"} name="${score.campaignName}" ` +
        `focus=${score.nameFocus} objective=${score.objectiveFocus.toFixed(2)} ` +
        `mixed=${score.mixedTopics.length} (${Date.now() - started}ms)`,
    );
    if (score.mixedTopics.length)
      console.log(`   mixed in: ${score.mixedTopics.join(", ")}`);
    if (score.shapeErrors.length)
      console.log(`   shape: ${score.shapeErrors.join(", ")}`);
  } catch (error) {
    console.log(`ERROR ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

const totals = aggregateStrategy(scores);
const failed = scores.filter(
  (s) => !strategyCasePassed(s, STRATEGY_EVAL_THRESHOLDS),
);

console.log("\n--- totals ---");
console.log(
  `name focus ${totals.nameFocus.toFixed(2)} (min ${STRATEGY_EVAL_THRESHOLDS.minNameFocus})`,
);
console.log(
  `objective focus ${totals.objectiveFocus.toFixed(2)} (min ${STRATEGY_EVAL_THRESHOLDS.minObjectiveFocus})`,
);
console.log(`mixed topics ${totals.mixed} across ${scores.length} cases`);
console.log(`shape errors ${totals.shapeErrors}`);
console.log(`${scores.length - failed.length}/${scores.length} cases passed`);

mkdirSync("qa-reports/eval", { recursive: true });
const reportPath = "qa-reports/eval/strategy-focus.json";
writeFileSync(
  reportPath,
  `${JSON.stringify({ totals, scores, thresholds: STRATEGY_EVAL_THRESHOLDS }, null, 2)}\n`,
);
console.log(`report: ${reportPath}`);

if (failed.length > 0) process.exitCode = 1;
