/**
 * Periodic eval for the directions brief (FEAT-033): does one real model call
 * produce two directions that are genuinely different concepts, inside the
 * contract, with reasons that say something about THIS brief?
 *
 * Paid lane: one structured completion per case (two when the redraft rule
 * fires), text plus the photograph on the upload cases, no image generation.
 * Run before shipping a change to src/lib/jobs/directions/, the directions
 * prompt or the model, and nightly. Not part of `pnpm test`.
 *
 * It runs the production function, draftDirections, so the finalising, the
 * redraft rule and the layout rule are measured exactly as they ship. Scoring
 * is deterministic (./score.ts).
 *
 * Usage: pnpm eval:design-directions [--case <id>] [--image <png|jpg>]
 *   --image defaults to /tmp/feat-033/fixtures/cutout.png when present; the
 *   upload cases run text-only without one, and the report says so.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
// A stale bearer token hijacks auth from the valid SigV4 keys and fails every
// call with "Forbidden".
process.env.AWS_BEARER_TOKEN_BEDROCK = "";

const { inferCategory } = await import("../../design-training/infer-category");
const { draftDirections } = await import("../../../jobs/directions/brief");
const { planConcepts } = await import("../../../jobs/directions/concepts");
const { DIRECTIONS_EVAL_CASES, DIRECTIONS_EVAL_THRESHOLDS } = await import(
  "./cases"
);
const { aggregateDirections, directionsPassed, scoreDirectionsCase } =
  await import("./score");

const args = process.argv.slice(2);
const flag = (name: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : null;
const only = flag("--case");
const imagePath =
  flag("--image") ??
  (existsSync("/tmp/feat-033/fixtures/cutout.png")
    ? "/tmp/feat-033/fixtures/cutout.png"
    : null);
const image = imagePath
  ? {
      bytes: new Uint8Array(readFileSync(imagePath)),
      contentType: imagePath.endsWith(".png") ? "image/png" : "image/jpeg",
    }
  : null;

const cases = only
  ? DIRECTIONS_EVAL_CASES.filter((c) => c.id === only)
  : DIRECTIONS_EVAL_CASES;
if (cases.length === 0) {
  console.error(only ? `No case named "${only}"` : "No cases defined");
  process.exit(1);
}
console.log(
  `upload cases ${image ? `see ${imagePath}` : "run text-only (no --image)"}`,
);

const scores = [];
const outputs = [];
for (const evalCase of cases) {
  process.stdout.write(`${evalCase.id} … `);
  const started = Date.now();
  const r = evalCase.request;
  const context = {
    source: "quick",
    brand: {
      id: "eval",
      name: evalCase.brand.name,
      logoUrl: evalCase.hasLogo ? "eval-logo" : null,
    },
    brandSummary: evalCase.brand,
    briefId: null,
    calendarItemId: null,
    attachments: [],
    title: r.title,
    briefText: r.briefText,
    designType: r.designType,
    dimensions: r.dimensions,
    aspectRatio: r.aspectRatio,
    platform: r.platform,
    scheduledFor: null,
    referenceUrls: [],
    logoAssetUrls: [],
    logoCandidates: [],
  } as never;
  const category = inferCategory(r.briefText, r.designType);
  try {
    const result = await draftDirections({
      context,
      imageSource: evalCase.imageSource,
      image: evalCase.imageSource === "upload" ? image : null,
      lenses: planConcepts(category),
      category,
      recentLayouts: [],
    });
    const score = scoreDirectionsCase(evalCase, result);
    scores.push(score);
    outputs.push({ id: evalCase.id, category, result });
    console.log(
      `${score.layouts.join(" / ")} distinct=${score.distinctness.toFixed(2)} ` +
        `grounded=${score.grounded}/${score.reasons} filler=${score.filler} ` +
        `${score.firstNearDuplicate ? "first-call-dup " : ""}${score.redrafted ? "redrafted " : ""}` +
        `(${Date.now() - started}ms)`,
    );
    for (const d of result.directions) {
      console.log(`   "${d.title}" — ${d.headline}`);
      for (const reason of d.rationale) console.log(`      · ${reason}`);
    }
  } catch (error) {
    /* The cause is what says which field broke the schema; the message
       alone ("did not match schema") cannot be acted on. */
    const cause = (error as { cause?: unknown }).cause;
    console.log(`ERROR ${(error as Error).message}`);
    if (cause) console.log(`   cause: ${String(cause).slice(0, 600)}`);
    process.exitCode = 1;
  }
}

const totals = aggregateDirections(scores);
const t = DIRECTIONS_EVAL_THRESHOLDS;
const passed = directionsPassed(totals, t, cases.length);

console.log("\n--- totals ---");
console.log(`cases scored ${totals.cases}/${cases.length}`);
console.log(
  `two directions ${totals.twoDirections.toFixed(2)} (min ${t.minTwoDirections})`,
);
console.log(
  `layouts differ ${totals.layoutsDiffer.toFixed(2)} (min ${t.minLayoutsDiffer}); model alone ${totals.modelLayoutsDiffer.toFixed(2)}`,
);
console.log(
  `within limits ${totals.withinLimits.toFixed(2)} (min ${t.minWithinLimits}); model alone ${totals.modelWithinLimits.toFixed(2)}`,
);
console.log(
  `grounded reasons ${totals.groundedShare.toFixed(2)} (min ${t.minGroundedShare}); model alone ${totals.modelGroundedShare.toFixed(2)}`,
);
console.log(
  `filler reasons ${totals.fillerShare.toFixed(2)} (max ${t.maxFillerShare})`,
);
console.log(
  `jargon reasons ${totals.jargonShare.toFixed(2)} (max ${t.maxJargonShare})`,
);
console.log(
  `shortened reasons ${totals.cutShare.toFixed(2)} (max ${t.maxCutShare})`,
);
console.log(
  `distinctness mean ${totals.meanDistinctness.toFixed(2)} (min ${t.minMeanDistinctness}), worst ${totals.minDistinctness.toFixed(2)}`,
);
console.log(
  `near-duplicates: first call ${totals.firstNearDuplicates}, delivered ${totals.finalNearDuplicates} (max ${t.maxFinalNearDuplicates}); redrafts ${totals.redrafts}; model calls ${totals.modelCalls}`,
);
console.log(`${passed ? "PASS" : "FAIL"} across ${scores.length} cases`);

mkdirSync("qa-reports/eval", { recursive: true });
const reportPath = "qa-reports/eval/design-directions.json";
writeFileSync(
  reportPath,
  `${JSON.stringify({ totals, thresholds: t, scores, outputs }, null, 2)}\n`,
);
console.log(`report: ${reportPath}`);

if (!passed) process.exitCode = 1;
