/**
 * Periodic eval for the brief generator — KOOS-AI-001.
 *
 * The step this scores had no eval at all. One generateObject call picked a
 * template out of four and wrote the brief in the same pass, so "post, flyer,
 * banner, story, ad" came out of one mould: a thumbnail was asked for
 * supporting copy it has no room for, and a flyer's venue and phone number
 * had no section of their own. It is now two calls — identify, then write
 * against that format's structure — and this lane is what proves a real model
 * actually follows the routing.
 *
 * Paid lane: two structured completions per case, text only. Run before
 * shipping a change to the brief prompts, the format table or the model.
 *
 * Scoring is deterministic (./score.ts). Whether the label resolves to the
 * right format, whether the required headings are present and whether a
 * number nobody supplied appeared each have one correct answer.
 *
 * Usage: pnpm eval:design-brief [--case <id>]
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
const { deliverableSchema, designBriefContentSchema } = await import(
  "../../design-brief-schema"
);
const {
  buildDeliverableIdentificationPrompt,
  buildDesignBriefGenerationPrompt,
  buildDesignBriefSystemPrompt,
  deliverableIdentificationSystemPrompt,
} = await import("../../prompts/design-request");
const { resolveDesignFormat } = await import("../../../design/formats");
const { BRIEF_EVAL_BRAND, BRIEF_EVAL_CASES, BRIEF_EVAL_THRESHOLDS } =
  await import("./cases");
const { aggregateBriefs, briefsPassed, scoreBriefCase } = await import(
  "./score"
);

/** Bedrock's 4096 default truncates a long brief into malformed JSON. */
const BRIEF_OUTPUT_TOKEN_CAP = 4000;

const args = process.argv.slice(2);
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;
const cases = only
  ? BRIEF_EVAL_CASES.filter((c) => c.id === only)
  : BRIEF_EVAL_CASES;

if (cases.length === 0) {
  console.error(only ? `No case named "${only}"` : "No cases defined");
  process.exit(1);
}

const scores = [];
const briefs: Record<string, string> = {};
let errors = 0;
for (const evalCase of cases) {
  process.stdout.write(`${evalCase.id} … `);
  const started = Date.now();
  try {
    const { object: deliverable } = await generateObject({
      model: getModel("strategy"),
      schema: deliverableSchema,
      system: deliverableIdentificationSystemPrompt(),
      prompt: buildDeliverableIdentificationPrompt(evalCase.conversation),
    });

    const { object: content } = await generateObject({
      model: getModel("strategy"),
      schema: designBriefContentSchema,
      system: buildDesignBriefSystemPrompt(
        BRIEF_EVAL_BRAND,
        resolveDesignFormat(deliverable.designType),
      ),
      prompt: buildDesignBriefGenerationPrompt(
        evalCase.conversation,
        BRIEF_EVAL_BRAND,
        deliverable,
      ),
      maxOutputTokens: BRIEF_OUTPUT_TOKEN_CAP,
    });

    const score = scoreBriefCase(evalCase, {
      designType: deliverable.designType,
      slides: deliverable.slides,
      briefMarkdown: content.briefMarkdown,
    });
    scores.push(score);
    /* Kept so a verdict can be audited by eye. A lane whose claim is "a real
       model's brief matches the routed structure" and which saves no brief
       cannot be checked by a human, and its false passes are invisible. */
    briefs[evalCase.id] = content.briefMarkdown;

    console.log(
      `"${deliverable.designType}" -> ${score.resolvedFormat}` +
        `${score.formatCorrect ? "" : ` (expected ${evalCase.expectedFormat})`} ` +
        `headline=${score.headlineWords}/${score.headlineBudget} ` +
        `missing=[${score.missingSections.join(",")}] ` +
        `forbidden=[${score.forbiddenPresent.join(",")}] ` +
        `(${Date.now() - started}ms)`,
    );
    if (score.suspectNumbers.length > 0)
      console.log(`   invented numbers: ${score.suspectNumbers.join(", ")}`);
    if (evalCase.expectsGap)
      console.log(
        `   gap handed to the designer: ${score.gapAcknowledged ? "yes" : "NO"}`,
      );
  } catch (error) {
    console.log(`ERROR ${(error as Error).message}`);
    errors += 1;
    process.exitCode = 1;
  }
}

const totals = aggregateBriefs(scores, cases);
const passed = briefsPassed(totals, BRIEF_EVAL_THRESHOLDS);

console.log("\n--- totals ---");
console.log(
  `format correct ${totals.formatCorrect.toFixed(2)} (min ${BRIEF_EVAL_THRESHOLDS.minFormatCorrect})`,
);
console.log(
  `structure clean ${totals.structureClean.toFixed(2)} (min ${BRIEF_EVAL_THRESHOLDS.minStructureClean})`,
);
console.log(
  `headline within budget ${totals.withinBudget.toFixed(2)} (min ${BRIEF_EVAL_THRESHOLDS.minWithinBudget})`,
);
console.log(
  `production notes ${totals.productionNotes.toFixed(2)} (min ${BRIEF_EVAL_THRESHOLDS.minProductionNotes})`,
);
console.log(
  `slide count coherent ${totals.slidesCoherent.toFixed(2)} (min ${BRIEF_EVAL_THRESHOLDS.minSlidesCoherent})`,
);
console.log(`invented numbers ${totals.inventedNumbers.length} (must be 0)`);
console.log(
  `gaps not handed over: ${totals.unacknowledgedGaps.join(", ") || "none"}`,
);
/* The shares are computed over the cases that RAN. Printing PASS while two
   cases died on a network failure is a verdict about four cases dressed up as
   a verdict about six. */
console.log(
  `${passed && errors === 0 ? "PASS" : "FAIL"} — scored ${scores.length} of ${cases.length} cases` +
    (errors > 0 ? `, ${errors} could not run` : ""),
);

mkdirSync("qa-reports/eval", { recursive: true });
const reportPath = "qa-reports/eval/design-brief-routing.json";
writeFileSync(
  reportPath,
  `${JSON.stringify({ totals, scores, briefs, errors, attempted: cases.length, thresholds: BRIEF_EVAL_THRESHOLDS }, null, 2)}\n`,
);
console.log(`report: ${reportPath}`);

if (!passed) process.exitCode = 1;
