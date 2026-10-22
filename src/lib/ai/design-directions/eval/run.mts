/**
 * Periodic eval for the directions brief (FEAT-033): does the model write two
 * genuinely different concepts, to length, stating only the brief's facts,
 * with "why this works" reasons that are true of the design, and does KO
 * imagery show the product the brief names?
 *
 * Paid lane: one structured completion per case (more when the fit pass or
 * the redraft rule fires), text plus the photograph on the upload cases, and
 * on KO cases that name a product, the real plate model plus the plate check
 * and one look by the eval itself per plate. Run before shipping a change to
 * src/lib/jobs/directions/, the directions prompt or either model, and
 * nightly. Not part of `pnpm test`.
 *
 * It runs the production functions, draftDirections and paintCheckedPlate,
 * so the fit pass, the finalising, the redraft rule, the layout rule and the
 * plate retry are measured as they ship. Plates are never uploaded; they are
 * saved to --out for a person to look at.
 *
 * Usage: pnpm eval:design-directions [--case <id>] [--image <png|jpg>]
 *          [--out <dir>] [--no-plates]
 *   --image defaults to /tmp/feat-033/fixtures/cutout.png when present.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

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
const { getPlateAdapter } = await import("../../image");
const { draftDirections } = await import("../../../jobs/directions/brief");
const { planConcepts, regenerationConcept } = await import(
  "../../../jobs/directions/concepts"
);
const { paintCheckedPlate } = await import("../../../jobs/directions/imagery");
const { designSpecOf } = await import("../../../jobs/directions/schema");
const { askVision } = await import("../../../design/quality/vision");
const { DIRECTIONS_EVAL_CASES, DIRECTIONS_EVAL_THRESHOLDS } = await import(
  "./cases"
);
const { aggregateDirections, directionsFailures, scoreDirectionsCase } =
  await import("./score");

const args = process.argv.slice(2);
const flag = (name: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : null;
const only = flag("--case");
const outDir = flag("--out") ?? "qa-reports/eval/design-directions-plates";
const withPlates = !args.includes("--no-plates");
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
const plateAdapter = withPlates ? getPlateAdapter() : null;
if (withPlates && !plateAdapter) {
  console.error("No plate model configured; pass --no-plates to skip plates.");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
console.log(
  `upload cases ${image ? `see ${imagePath}` : "run text-only (no --image)"}; plates ${withPlates ? `to ${outDir}` : "skipped"}`,
);

/* The eval's own look at a delivered plate. A different question from the
   product's check (what is in it, then whether that is the product), so a
   plate the check waved through on a leading question is still caught. */
const lookSchema = z.object({
  subject: z.string(),
  isProduct: z.enum(["yes", "no"]),
});
async function lookAt(bytes: Uint8Array, product: string) {
  const { default: sharp } = await import("sharp");
  const small = await sharp(bytes)
    .resize(768, 768, { fit: "inside" })
    .jpeg({ quality: 82 })
    .toBuffer();
  const answer = await askVision({
    schema: lookSchema,
    system:
      "You describe photographs plainly and literally. Name what is actually in the picture, not what it might be meant to be.",
    text: `First, name the main subject of this photograph in a few words. Then answer: is that subject ${product}? A similar but different item is "no".`,
    image: { bytes: new Uint8Array(small), mediaType: "image/jpeg" },
    maxOutputTokens: 200,
    timeoutMs: 30_000,
    label: "eval plate look",
  });
  return { subject: answer.subject, shows: answer.isProduct === "yes" };
}

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
  const existing = evalCase.regenerate?.existing ?? [];
  try {
    const result = await draftDirections({
      context,
      imageSource: evalCase.imageSource,
      image: evalCase.imageSource === "upload" ? image : null,
      lenses:
        existing.length > 0
          ? [regenerationConcept(category)]
          : planConcepts(category),
      recentLayouts: [],
      existing,
    });

    const plates = [];
    if (plateAdapter && evalCase.imageSource === "ko" && evalCase.product) {
      const painted = await Promise.all(
        result.directions.map(async (direction, i) => {
          const plate = await paintCheckedPlate({
            adapter: plateAdapter,
            spec: designSpecOf(direction),
            product: direction.productName
              ? { name: direction.productName, look: direction.productLook }
              : null,
          });
          let look: { subject: string; shows: boolean | null } = {
            subject: "",
            shows: null,
          };
          if (plate.image) {
            writeFileSync(
              join(
                outDir,
                `${evalCase.id}-${i}.${plate.image.contentType === "image/jpeg" ? "jpg" : "png"}`,
              ),
              plate.image.bytes,
            );
            look = await lookAt(
              plate.image.bytes,
              direction.productName || evalCase.product || "",
            ).catch((err) => {
              console.log(`   plate look failed: ${(err as Error).message}`);
              return { subject: "", shows: null };
            });
          }
          return {
            check: plate.check,
            imageCalls: plate.imageCalls,
            showsProduct: look.shows,
            subject: look.subject,
            rejected: plate.seen,
          };
        }),
      );
      plates.push(...painted);
    }

    const score = scoreDirectionsCase(evalCase, result, plates);
    scores.push(score);
    outputs.push({ id: evalCase.id, category, result, plates });
    console.log(
      `${score.layouts.join(" / ")} distinct=${score.distinctness.toFixed(2)} ` +
        `model: fit ${score.modelDirectionsWithinLimits}/${score.modelDirections} grounded ${score.modelGrounded}/${score.modelReasons} ` +
        `spatial ${score.modelSpatial} invented ${score.modelInvented}/${score.modelFields} ` +
        `| delivered: grounded ${score.grounded}/${score.reasons} invented ${score.invented} false ${score.falseClaims} cut ${score.cutOff} ` +
        `| fit ${score.fitFixed}/${score.fitAsked}${score.redrafted ? " redrafted" : ""} (${Date.now() - started}ms)`,
    );
    if (score.modelInventedExamples.length > 0) {
      console.log(
        `   model invented: ${score.modelInventedExamples.join(", ")}`,
      );
    }
    for (const [i, d] of result.directions.entries()) {
      console.log(
        `   "${d.title}" — ${d.headline} | ${d.subheadline ?? ""} | [${d.cta ?? ""}] product="${d.productName}"`,
      );
      for (const reason of d.rationale) console.log(`      · ${reason}`);
      for (const dropped of result.reports[i]?.reasonsDropped ?? []) {
        console.log(`      x ${dropped.reason}  (${dropped.why})`);
      }
      for (const fallback of result.reports[i]?.copyFallbacks ?? []) {
        console.log(
          `      ~ ${fallback.field}: "${fallback.from}" -> ${fallback.to === null ? "left off" : `"${fallback.to}"`}`,
        );
      }
      const plate = plates[i];
      if (plate) {
        console.log(
          `      plate: ${plate.check} (${plate.imageCalls} call${plate.imageCalls === 1 ? "" : "s"}), eval sees "${plate.subject}" -> ${plate.showsProduct}`,
        );
      }
    }
  } catch (error) {
    /* The cause is what says which field broke the schema; the message
       alone ("did not match schema") cannot be acted on. */
    const cause = (error as { cause?: unknown }).cause;
    console.log(`ERROR ${(error as Error).message}`);
    if (cause) {
      const text = String(cause);
      const issues = text.indexOf("Error message:");
      console.log(
        `   cause: ${issues >= 0 ? text.slice(issues, issues + 1500) : text.slice(-1500)}`,
      );
    }
    process.exitCode = 1;
  }
}

const totals = aggregateDirections(scores);
const t = DIRECTIONS_EVAL_THRESHOLDS;
const failures = directionsFailures(totals, t, cases.length);
const f2 = (n: number) => n.toFixed(2);

console.log("\n--- model's own answer ---");
console.log(
  `writes to length ${f2(totals.modelWithinLimits)} (min ${t.minModelWithinLimits})`,
);
console.log(
  `grounded reasons ${f2(totals.modelGroundedShare)} (min ${t.minModelGroundedShare})`,
);
console.log(
  `spatial reasons ${f2(totals.modelSpatialShare)} (max ${t.maxModelSpatialShare})`,
);
console.log(
  `invented facts ${f2(totals.modelInventedShare)} of fields (max ${t.maxModelInventedShare})`,
);
console.log(
  `cut-off reasons ${f2(totals.modelCutOffShare)} (max ${t.maxModelCutOffShare})`,
);
console.log(`layouts differ ${f2(totals.modelLayoutsDiffer)}`);
console.log("\n--- delivered ---");
console.log(
  `cases scored ${totals.cases}/${cases.length}; direction count right ${f2(totals.countRight)}`,
);
console.log(
  `layouts differ ${f2(totals.layoutsDiffer)}; within limits ${f2(totals.withinLimits)}`,
);
console.log(
  `grounded ${f2(totals.groundedShare)} (min ${t.minGroundedShare}); filler ${f2(totals.fillerShare)} (max ${t.maxFillerShare})`,
);
console.log(
  `jargon ${totals.jargon}, spatial ${totals.spatial}, cut off ${totals.cutOff}, false claims ${totals.falseClaims}, invented ${totals.invented} (each max 0)`,
);
console.log(
  `distinctness mean ${f2(totals.meanDistinctness)} (min ${t.minMeanDistinctness}), worst ${f2(totals.minDistinctness)}`,
);
console.log(
  `near-duplicates: first call ${totals.firstNearDuplicates}, delivered ${totals.finalNearDuplicates}; redrafts ${totals.redrafts}`,
);
console.log(
  `fit pass: ${totals.fitFixed}/${totals.fitAsked} fields fixed; model calls ${totals.modelCalls}`,
);
console.log(
  `product named ${f2(totals.productNamed)} (min ${t.minProductNamed})`,
);
console.log(
  `plates ${totals.plates}: show the product ${f2(totals.plateShowsProduct)} (min ${t.minPlateShowsProduct}), wrong product delivered ${totals.wrongProductPlates} (max ${t.maxWrongProductPlates}), retried ${totals.platesRetried}, drawn flat ${totals.platesFlat}, plate calls ${totals.plateImageCalls}`,
);
console.log(
  failures.length === 0
    ? `PASS across ${scores.length} cases`
    : `FAIL across ${scores.length} cases: ${failures.join("; ")}`,
);

mkdirSync("qa-reports/eval", { recursive: true });
const reportPath = "qa-reports/eval/design-directions.json";
writeFileSync(
  reportPath,
  `${JSON.stringify({ totals, thresholds: t, failures, scores, outputs }, null, 2)}\n`,
);
console.log(`report: ${reportPath}`);

if (failures.length > 0) process.exitCode = 1;
