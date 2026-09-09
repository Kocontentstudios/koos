/**
 * Periodic eval for the art-director step (design spec generation).
 *
 * This lane exists because eval:design does NOT cover it: that suite calls the
 * image adapter with literal prompt strings and never builds
 * buildDesignSpecSystemPrompt, so the prompt that decides a design's palette
 * had no eval at all. The regression it guards is real — the prompt used to
 * tell the model to draw the palette from "the brand's colours" while
 * brandBlock emitted none, so the model was asked for something it was never given.
 *
 * Paid lane: one structured completion per case, text only — no images, so it
 * is far cheaper than eval:design. Run before shipping a change to the
 * design-spec prompt, the spec schema or the model, and nightly.
 *
 * Scoring is deterministic (see ./score.ts). Whether a palette slot equals a
 * stated brand colour, and whether two colours clear 4.5:1, both have one
 * correct answer given the output, so neither goes to a judge.
 *
 * Usage: pnpm eval:design-spec [--case <id>]
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
const { designSpecSchema } = await import("../../../design/spec");
const { buildDesignSpecSystemPrompt } = await import(
  "../../prompts/design-spec"
);
const { DESIGN_SPEC_EVAL_CASES, DESIGN_SPEC_EVAL_THRESHOLDS } = await import(
  "./cases"
);
const { aggregateDesignSpec, designSpecPassed, scoreDesignSpecCase } =
  await import("./score");

/** Bedrock's 4096 default truncates a spec into malformed JSON. */
const SPEC_OUTPUT_TOKEN_CAP = 4000;

const args = process.argv.slice(2);
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;
const cases = only
  ? DESIGN_SPEC_EVAL_CASES.filter((c) => c.id === only)
  : DESIGN_SPEC_EVAL_CASES;

if (cases.length === 0) {
  console.error(only ? `No case named "${only}"` : "No cases defined");
  process.exit(1);
}

/** Mirrors buildDesignSpecPrompt without needing a full DesignContext row. */
function requestPrompt(r: (typeof cases)[number]["request"]): string {
  const lines = [
    `Title: ${r.title}`,
    `Design type: ${r.designType}`,
    `Dimensions: ${r.dimensions}`,
    `Platform: ${r.platform}`,
    `Target aspect ratio: ${r.aspectRatio}`,
  ];
  return `Design request:\n${lines.join("\n")}\n\nBrief:\n${r.briefText}`;
}

const scores = [];
for (const evalCase of cases) {
  process.stdout.write(`${evalCase.id} … `);
  const started = Date.now();
  try {
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema: designSpecSchema,
      system: buildDesignSpecSystemPrompt(evalCase.brand),
      prompt: requestPrompt(evalCase.request),
      maxOutputTokens: SPEC_OUTPUT_TOKEN_CAP,
    });
    const score = scoreDesignSpecCase(evalCase, object);
    scores.push(score);
    const brandUse =
      score.usesBrandColor === null ? "n/a" : String(score.usesBrandColor);
    console.log(
      `hex=${score.validHex} brand=${brandUse} contrast=${score.contrastOk} ` +
        `[${object.palette.background}/${object.palette.foreground}/${object.palette.accent}] ` +
        `(${Date.now() - started}ms)`,
    );
    if (score.honorsNamedColor === false)
      console.log("   named colour missed its hue");
  } catch (error) {
    console.log(`ERROR ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

const totals = aggregateDesignSpec(scores);
const passed = designSpecPassed(totals, DESIGN_SPEC_EVAL_THRESHOLDS);

console.log("\n--- totals ---");
console.log(
  `valid hex ${totals.validHex.toFixed(2)} (min ${DESIGN_SPEC_EVAL_THRESHOLDS.minValidHex})`,
);
console.log(
  `brand colour use ${totals.brandColorUse.toFixed(2)} (min ${DESIGN_SPEC_EVAL_THRESHOLDS.minBrandColorUse})`,
);
console.log(
  `contrast ok ${totals.contrastOk.toFixed(2)} (min ${DESIGN_SPEC_EVAL_THRESHOLDS.minContrastOk})`,
);
console.log(`named colour misses ${totals.namedColorMisses.length}`);
console.log(`${passed ? "PASS" : "FAIL"} across ${scores.length} cases`);

mkdirSync("qa-reports/eval", { recursive: true });
const reportPath = "qa-reports/eval/design-spec-palette.json";
writeFileSync(
  reportPath,
  `${JSON.stringify({ totals, scores, thresholds: DESIGN_SPEC_EVAL_THRESHOLDS }, null, 2)}\n`,
);
console.log(`report: ${reportPath}`);

if (!passed) process.exitCode = 1;
