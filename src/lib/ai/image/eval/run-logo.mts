/**
 * Periodic eval for brand-logo delivery.
 *
 * The lane `eval:design` does not cover this. That suite hands literal prompt
 * strings to the image adapter and never touches the renderer, so the code
 * that actually places the logo — the composite overlay and the native stamp —
 * had no eval coverage at all. The regression it guards is real and shipped:
 * the art director chose `logoPlacement: "none"`, the loader mislabelled every
 * logo as a PNG, and a brand's mark reached no design (KOOS-BUG-022).
 *
 * Paid lane, but cheap: only the native case and the one plated composite case
 * spend on an image (2 x ~$0.134 on Nano Banana Pro). Everything else renders
 * locally. Legibility arithmetic stays out of it — the only question asked of
 * the judge is whether the mark survived, which no amount of byte-counting can
 * answer.
 *
 * Usage: pnpm eval:design-logo [--case <id>]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { LOGO_EVAL_CASES } from "./logo-cases";
import {
  aggregateLogoScores,
  LOGO_EVAL_THRESHOLDS,
  type LogoEvalScore,
  scoreLogoCase,
} from "./logo-score";

const args = process.argv.slice(2);
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;

// Same service-account file the app uses in Vercel, so the eval exercises the
// Vertex transport rather than a local-only shortcut.
const keyPath = join(homedir(), "dev247/envs/koos/vertex-sa-key.json");
const key = JSON.parse(readFileSync(keyPath, "utf8"));
process.env.GOOGLE_VERTEX_PROJECT = key.project_id;
process.env.GOOGLE_VERTEX_LOCATION = "global";
process.env.GOOGLE_CLIENT_EMAIL = key.client_email;
process.env.GOOGLE_PRIVATE_KEY = key.private_key;

const { googleAdapter } = await import("../adapters/google");
const { renderCompositeDesign } = await import(
  "../../../design/render/composite"
);
const { overlayLogo } = await import("../../../design/render/logo-overlay");
const { SQUARE_MARK, WORDMARK } = await import(
  "../../../design/render/logo-fixtures"
);
const { canvasFor } = await import("../../../design/canvas");
const { buildBackgroundPlatePrompt, buildNativePrompt } = await import(
  "../../prompts/design-spec"
);
const { judgeLogo, JudgeUnavailableError } = await import("./judge.mjs");

const outDir = "qa-reports/eval";
mkdirSync(outDir, { recursive: true });

const cases = only
  ? LOGO_EVAL_CASES.filter((c) => c.id === only)
  : LOGO_EVAL_CASES;
if (cases.length === 0) throw new Error(`No case matching "${only}"`);

const brand = {
  name: "Lagos Loom",
  primaryColor: "#0F172A",
  secondaryColor: "#F97316",
};

console.log(`model:  ${googleAdapter.model}`);
console.log(`cases:  ${cases.length}\n`);

const scores: LogoEvalScore[] = [];
const rows: { id: string; detail: string }[] = [];

for (const testCase of cases) {
  process.stdout.write(`${testCase.id} … `);
  const started = Date.now();
  // biome-ignore lint/suspicious/noExplicitAny: eval cases carry partial specs
  const spec = testCase.spec as any;
  const logoBytes = testCase.mark === "wordmark" ? WORDMARK() : SQUARE_MARK();
  /* The eval renders straight through, so it supplies what the loader would
     normally measure. Mid-dark ink on both ends: a flat mark. */
  const logo = {
    bytes: logoBytes,
    contentType: "image/png",
    darkest: 0.185,
    lightest: 0.185,
    aspect: testCase.mark === "wordmark" ? 3 : 1,
  };

  try {
    let bytes: Uint8Array;

    if (testCase.route === "composite") {
      const plate = testCase.withPlate
        ? await googleAdapter.generate({
            prompt: buildBackgroundPlatePrompt(spec),
            aspectRatio: spec.aspectRatio,
          })
        : null;
      const result = await renderCompositeDesign({
        spec,
        brand,
        plate,
        // The logo-free case must reach the renderer WITH a logo available:
        // the assertion is that placement suppresses it, not that nothing was
        // loaded.
        logo,
      });
      bytes = result.bytes;
    } else {
      const image = await googleAdapter.generate({
        prompt: buildNativePrompt(spec, brand),
        aspectRatio: spec.aspectRatio,
      });
      ({ bytes } = await overlayLogo({
        image,
        logo,
        placement: spec.logoPlacement,
        layout: spec.layout,
        canvas: canvasFor(spec.aspectRatio),
      }));
    }

    const file = join(outDir, `logo-${testCase.id}.png`);
    writeFileSync(file, bytes);

    const verdict = await judgeLogo(file, testCase.expectLogo);
    const score = scoreLogoCase(
      testCase.id,
      { logo: testCase.expectLogo, placement: spec.logoPlacement },
      verdict,
    );
    scores.push(score);
    const detail = `count=${verdict.logoCount} corner="${verdict.corner}" distorted=${verdict.distorted} onText=${verdict.overlapsText} — ${verdict.notes} (${((Date.now() - started) / 1000).toFixed(1)}s)`;
    rows.push({ id: testCase.id, detail });
    console.log(
      `present ${score.present ? "OK" : "FAIL"} / placed ${score.placed ? "OK" : "FAIL"} / clean ${score.clean ? "OK" : "FAIL"}`,
    );
    console.log(`    ${detail}`);
  } catch (err) {
    /* A judge that could not run has not judged anything. Reporting 0 for the
       design would be a lie about the design, so the run stops instead. */
    if (err instanceof JudgeUnavailableError) {
      console.error(`\n${err.message} — aborting rather than scoring blind.`);
      process.exit(2);
    }
    scores.push({
      id: testCase.id,
      present: false,
      placed: false,
      clean: false,
    });
    const detail = `ERROR ${err instanceof Error ? err.message.slice(0, 160) : err}`;
    rows.push({ id: testCase.id, detail });
    console.log(`FAIL\n    ${detail}`);
  }
}

const totals = aggregateLogoScores(scores);
const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

console.log("\n─────────────────────────────────────────────");
console.log(
  `present  ${pct(totals.present)}  (threshold ${pct(LOGO_EVAL_THRESHOLDS.minPresent)})`,
);
console.log(
  `placed   ${pct(totals.placed)}  (threshold ${pct(LOGO_EVAL_THRESHOLDS.minPlaced)})`,
);
console.log(
  `clean    ${pct(totals.clean)}  (threshold ${pct(LOGO_EVAL_THRESHOLDS.minClean)})`,
);

writeFileSync(
  join(outDir, "logo-report.json"),
  JSON.stringify(
    { model: googleAdapter.model, ...totals, scores, rows },
    null,
    2,
  ),
);
console.log(`\nimages + logo-report.json in ${outDir}/`);
console.log(totals.passed ? "PASS" : "FAIL");
process.exit(totals.passed ? 0 : 1);
