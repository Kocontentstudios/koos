/**
 * Periodic eval for reading a PDF the text path cannot (KOOS-V1-FEAT-031).
 *
 * Paid lane: each case is one real generateObject call carrying the PDF as a
 * file part, so a run costs roughly cases x one structured completion with a
 * document attached. Run it before shipping a change to the extraction schema,
 * the prompt, or the model — a model swap is the likeliest way to lose
 * document support silently, because the fallback is a polite refusal rather
 * than an error.
 *
 * Scoring is the deterministic scorer the transcript eval uses: whether a
 * field was filled, and whether its value carries the document's factual
 * anchor, both have one correct answer.
 *
 * HONEST LIMITATION: the fixtures are built at runtime (the Safety rule
 * forbids committing binaries) and a hand-written PDF carries a text layer, so
 * these cases prove the PDF reaches the model and is read — not that a true
 * scan is OCR'd. Only a real scanned deck proves that; keep one outside the
 * repo and run it through staging after a model change.
 *
 * Usage: pnpm eval:scanned-pdf [--case <id>]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}
// A stale bearer token hijacks auth from the valid SigV4 keys and fails every
// call with "Forbidden".
process.env.AWS_BEARER_TOKEN_BEDROCK = "";

const { readScannedPdf } = await import("../scanned-pdf");
const { pdfFixture } = await import("../../../documents/fixtures");
const { scoreCase, casePassed, aggregate } = await import("./score");
const { EXTRACTION_EVAL_THRESHOLDS } = await import("./cases");
const { SCANNED_PDF_EVAL_CASES } = await import("./scanned-cases");

const only = process.argv.includes("--case")
  ? process.argv[process.argv.indexOf("--case") + 1]
  : null;
const cases = only
  ? SCANNED_PDF_EVAL_CASES.filter((c) => c.id === only)
  : SCANNED_PDF_EVAL_CASES;

const scores = [];

for (const testCase of cases) {
  process.stdout.write(`${testCase.id}… `);
  try {
    const started = Date.now();
    const result = await readScannedPdf({
      bytes: pdfFixture(testCase.pages),
      fileName: testCase.fileName,
      conversation: testCase.conversation,
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    if (!result) {
      console.log(`REFUSED after ${seconds}s — the provider did not read it.`);
      process.exitCode = 1;
      continue;
    }

    const score = scoreCase(testCase, result.fields as Record<string, string>);
    scores.push(score);
    console.log(
      `${casePassed(score, EXTRACTION_EVAL_THRESHOLDS) ? "PASS" : "FAIL"} ` +
        `recall ${score.recall.toFixed(2)} value ${score.valueAccuracy.toFixed(2)} (${seconds}s)`,
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
const reportPath = "qa-reports/eval/scanned-pdf.json";
writeFileSync(
  reportPath,
  `${JSON.stringify({ totals, scores, thresholds: EXTRACTION_EVAL_THRESHOLDS }, null, 2)}\n`,
);
console.log(`report: ${reportPath}`);

if (failed.length > 0) process.exitCode = 1;
