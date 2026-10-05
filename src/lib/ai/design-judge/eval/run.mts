/**
 * Periodic eval for the rubric judge (module 06 §10-§11 correction pass).
 *
 * The number this lane exists for is the **acceptance rate**: how often a real
 * model's prescription survives the guards in `quality/judge.ts`. Nothing else
 * measures it. `correct()` has seven ways to refuse a prescription and the gate
 * tests protect every one of them, which means the judge could refuse 100% of
 * its own answers in production and the whole suite would stay green — a
 * reasoning call per failed variant, bought and then declined.
 *
 * Paid lane: one structured completion per case, with the rendered design
 * attached on the cases that have readable pixels. The designs themselves are
 * rendered locally through the real composite path (see ./images.ts), so a run
 * costs reasoning tokens and no image generations.
 *
 * Scoring is deterministic (./score.ts). Whether a verdict came back, which
 * guard refused it, whether the route draws the field, and whether the spec
 * actually changed all have one correct answer given the output, so none of it
 * goes to a second model.
 *
 * Run it before shipping a change to `src/lib/design/quality/judge.ts`, to the
 * field guide inside it, or to the model — and nightly. Not part of `pnpm test`.
 *
 * Usage: pnpm eval:design-judge [--case <id>]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}
// A stale bearer token hijacks auth from the valid SigV4 keys and fails every
// call with "Forbidden".
process.env.AWS_BEARER_TOKEN_BEDROCK = "";

const { judgeAndCorrect, correctionSummary } = await import(
  "../../../design/quality/judge"
);
const { DESIGN_JUDGE_EVAL_CASES, DESIGN_JUDGE_EVAL_THRESHOLDS } = await import(
  "./cases"
);
const { imageForCase } = await import("./images");
const { aggregateDesignJudge, designJudgePassed, scoreDesignJudgeCase } =
  await import("./score");

/* The runtime budget is 20s so a slow critic never becomes the wait the user
 * notices. Offline there is no user, and a timeout here would be recorded as
 * "the model gave no verdict" — measuring the network instead of the judge.
 * `JudgeAndCorrectArgs.timeoutMs` exists for exactly this. */
const EVAL_TIMEOUT_MS = 90_000;

/* EAI_AGAIN happens in this environment. One retry separates a flaky resolver
   from a model that genuinely had no verdict. */
const ATTEMPTS = 2;

const args = process.argv.slice(2);
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;
const cases = only
  ? DESIGN_JUDGE_EVAL_CASES.filter((c) => c.id === only)
  : DESIGN_JUDGE_EVAL_CASES;

if (cases.length === 0) {
  console.error(only ? `No case named "${only}"` : "No cases defined");
  process.exit(1);
}

const outDir = "qa-reports/eval/design-judge";
mkdirSync(outDir, { recursive: true });

console.log(`cases: ${cases.length}\n`);

const scores = [];
const rows: Record<string, unknown>[] = [];

for (const evalCase of cases) {
  process.stdout.write(`${evalCase.id} … `);
  const started = Date.now();

  try {
    const fixture = await imageForCase(evalCase);
    if (fixture.bytes) {
      writeFileSync(join(outDir, `${evalCase.id}.png`), fixture.bytes);
    }

    const judgeArgs = {
      spec: evalCase.spec,
      renderer: evalCase.renderer,
      faults: evalCase.faults,
      image: fixture.bytes,
      brief: evalCase.brief,
      brand: evalCase.brand,
      hasLogo: evalCase.hasLogo,
      timeoutMs: EVAL_TIMEOUT_MS,
    };

    /* judgeAndCorrect is fail-soft by contract: a transient DNS failure comes
       back as "no verdict" rather than as a throw, so the retry is keyed on
       the empty verdict and not on an exception. */
    let result = await judgeAndCorrect(judgeArgs);
    for (
      let attempt = 2;
      attempt <= ATTEMPTS && !result.verdict;
      attempt += 1
    ) {
      process.stdout.write("retry … ");
      result = await judgeAndCorrect(judgeArgs);
    }

    const score = scoreDesignJudgeCase(
      {
        id: evalCase.id,
        renderer: evalCase.renderer,
        spec: evalCase.spec,
        hasLogo: evalCase.hasLogo,
        /* visualEvidence withholds the flat frame and has nothing to send for
           the missing bytes, so only the rendered cases should see pixels. */
        expectSawImage: evalCase.image === "render",
      },
      result,
    );
    scores.push(score);
    rows.push({
      ...score,
      what: evalCase.what,
      presents: evalCase.presents,
      image: evalCase.image,
      density: fixture.density,
      summary: correctionSummary(result),
    });

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `${score.accepted ? "ACCEPTED" : `refused (${score.refusedBy ?? "unattributed"})`} ` +
        `— saw=${score.sawImageAsExpected ? "ok" : "WRONG"} ${correctionSummary(result)} (${elapsed}s)`,
    );
  } catch (error) {
    console.log(`ERROR ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

const totals = aggregateDesignJudge(scores);
const passed = designJudgePassed(totals, DESIGN_JUDGE_EVAL_THRESHOLDS);

console.log("\n--- totals ---");
console.log(
  `acceptance rate ${totals.acceptanceRate.toFixed(2)} (min ${DESIGN_JUDGE_EVAL_THRESHOLDS.minAcceptanceRate})`,
);
console.log(
  `verdict rate ${totals.verdictRate.toFixed(2)} (min ${DESIGN_JUDGE_EVAL_THRESHOLDS.minVerdictRate})`,
);
console.log(
  `symptom treats field ${totals.symptomTreatsField.toFixed(2)} (min ${DESIGN_JUDGE_EVAL_THRESHOLDS.minSymptomTreatsField})`,
);
console.log(
  `scores in range ${totals.scoresInRange.toFixed(2)} (min ${DESIGN_JUDGE_EVAL_THRESHOLDS.minScoresInRange})`,
);
console.log(
  `saw image as expected ${totals.sawImageAsExpected.toFixed(2)} (min ${DESIGN_JUDGE_EVAL_THRESHOLDS.minSawImageAsExpected})`,
);
console.log(
  `refusals ${Object.keys(totals.refusals).length === 0 ? "none" : JSON.stringify(totals.refusals)}`,
);
console.log(`undrawn fields ${totals.undrawnFields.length}`);
console.log(`unchanged corrections ${totals.unchangedCorrections.length}`);
console.log(`unattributed refusals ${totals.unattributedRefusals.length}`);
console.log(`${passed ? "PASS" : "FAIL"} across ${scores.length} cases`);

const reportPath = "qa-reports/eval/design-judge.json";
writeFileSync(
  reportPath,
  `${JSON.stringify(
    {
      ranAt: new Date().toISOString(),
      thresholds: DESIGN_JUDGE_EVAL_THRESHOLDS,
      totals,
      cases: rows,
    },
    null,
    2,
  )}\n`,
);
console.log(`report:  ${reportPath}`);
console.log(`renders: ${outDir}/`);

if (!passed) process.exitCode = 1;
