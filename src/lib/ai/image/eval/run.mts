/**
 * Periodic eval for design image generation.
 *
 * Paid lane: every case renders a real image, so a run costs roughly
 * cases x per-image price (5 x $0.134 on Nano Banana Pro). Not for CI on every
 * commit -- run before shipping a change to the image path, and nightly.
 *
 * Scoring is split deliberately. Dimensions, aspect ratio and "is this frame
 * blank" have one correct answer given the inputs, so they are computed, not
 * asked. Only legibility goes to the judge.
 *
 * Usage: pnpm eval:design [--case <id>] [--model <id>]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import {
  DESIGN_EVAL_CASES,
  EVAL_THRESHOLDS,
  expectedPixelRatio,
  RATIO_TOLERANCE,
} from "./cases";

const args = process.argv.slice(2);
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;
const modelOverride = args.includes("--model")
  ? args[args.indexOf("--model") + 1]
  : null;

// Credentials come from the same service-account file the app uses in Vercel,
// so the eval exercises the Vertex transport rather than a local-only shortcut.
const keyPath = join(homedir(), "dev247/envs/koos/vertex-sa-key.json");
const key = JSON.parse(readFileSync(keyPath, "utf8"));
process.env.GOOGLE_VERTEX_PROJECT = key.project_id;
process.env.GOOGLE_VERTEX_LOCATION = "global";
process.env.GOOGLE_CLIENT_EMAIL = key.client_email;
process.env.GOOGLE_PRIVATE_KEY = key.private_key;
if (modelOverride) process.env.AI_DESIGN_GOOGLE_MODEL = modelOverride;

const { googleAdapter } = await import("../adapters/google");
const { activeGoogleTransport } = await import("../../google-transport");
const { judgeImage } = await import("./judge.mjs");

const outDir = "qa-reports/eval";
mkdirSync(outDir, { recursive: true });

const cases = only
  ? DESIGN_EVAL_CASES.filter((c) => c.id === only)
  : DESIGN_EVAL_CASES;
if (cases.length === 0) throw new Error(`No case matching "${only}"`);

console.log(`transport: ${activeGoogleTransport()}`);
console.log(`model:     ${googleAdapter.model}`);
console.log(`cases:     ${cases.length}\n`);

interface Row {
  id: string;
  structural: boolean;
  legible: boolean | null;
  detail: string;
}
const rows: Row[] = [];

for (const testCase of cases) {
  process.stdout.write(`${testCase.id} ... `);
  const started = Date.now();
  let row: Row;

  try {
    const image = await googleAdapter.generate({
      prompt: testCase.prompt,
      aspectRatio: testCase.aspectRatio,
    });
    const file = join(outDir, `${testCase.id}.png`);
    writeFileSync(file, image.bytes);

    const meta = await sharp(image.bytes).metadata();
    const stats = await sharp(image.bytes).stats();
    const ratio = (meta.width ?? 0) / (meta.height ?? 1);
    const want = expectedPixelRatio(testCase.aspectRatio);
    const ratioOk = Math.abs(ratio - want) <= RATIO_TOLERANCE;
    // A frame with no variation is a rendering failure that still returns 200.
    const notBlank = stats.channels.some((c) => c.stdev > 2);
    const structural = ratioOk && notBlank && (meta.width ?? 0) > 0;

    const verdict = await judgeImage(file, testCase.expectedText);
    const legible =
      testCase.expectedText === null
        ? verdict.textFound.trim() === ""
        : verdict.legible && verdict.spelledCorrectly;

    const detail = [
      `${meta.width}x${meta.height}`,
      `ratio ${ratio.toFixed(3)} want ${want.toFixed(3)}${ratioOk ? "" : " MISMATCH"}`,
      notBlank ? "" : "BLANK",
      testCase.expectedText === null
        ? verdict.textFound.trim() === ""
          ? "no text (correct)"
          : `unwanted text "${verdict.textFound}"`
        : `saw "${verdict.textFound}"`,
      `${((Date.now() - started) / 1000).toFixed(1)}s`,
    ]
      .filter(Boolean)
      .join("  ");

    row = { id: testCase.id, structural, legible, detail };
  } catch (err) {
    row = {
      id: testCase.id,
      structural: false,
      legible: false,
      detail: `ERROR ${err instanceof Error ? err.message.slice(0, 120) : err}`,
    };
  }

  rows.push(row);
  console.log(
    `${row.structural ? "structural OK" : "structural FAIL"} / ${
      row.legible ? "legible OK" : "legible FAIL"
    }`,
  );
  console.log(`    ${row.detail}`);
}

const structuralRate = rows.filter((r) => r.structural).length / rows.length;
const legibleRate = rows.filter((r) => r.legible).length / rows.length;

console.log("\n─────────────────────────────────────────────");
console.log(
  `structural  ${(structuralRate * 100).toFixed(0)}%  (threshold ${(
    EVAL_THRESHOLDS.structuralPassRate * 100
  ).toFixed(0)}%)`,
);
console.log(
  `legibility  ${(legibleRate * 100).toFixed(0)}%  (threshold ${(
    EVAL_THRESHOLDS.textLegibilityPassRate * 100
  ).toFixed(0)}%)`,
);

writeFileSync(
  join(outDir, "report.json"),
  JSON.stringify(
    { model: googleAdapter.model, structuralRate, legibleRate, rows },
    null,
    2,
  ),
);
console.log(`\nimages + report.json in ${outDir}/`);

const passed =
  structuralRate >= EVAL_THRESHOLDS.structuralPassRate &&
  legibleRate >= EVAL_THRESHOLDS.textLegibilityPassRate;
console.log(passed ? "PASS" : "FAIL");
process.exit(passed ? 0 : 1);
