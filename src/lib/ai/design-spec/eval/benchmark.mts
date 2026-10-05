/**
 * Benchmark: the design pipeline with and without the training system.
 *
 * KOOS-AI-001 deliverable #8. Five briefs, each art-directed twice — once with
 * AI_DESIGN_TRAINING off, once on — against the same brand, model and brief,
 * so the training system is the only variable.
 *
 * Paid lane: 10 structured completions per run (2 per case). It does NOT
 * render images by default; the spec is where the training system does its
 * work, and 10 image generations cost real money and up to 10 minutes of 2K
 * latency. Pass --render to generate images too, once the specs look right.
 *
 * HONEST LIMITATION, stated here because it is easy to forget when a number
 * goes up: the deterministic scores below measure what has one correct answer
 * — headline length against the format's budget, invented phone numbers,
 * layout variety. Whether the design is actually better is not scored. A
 * judge from the same model family grading its own output is weak evidence,
 * so this harness does not pretend to settle it. Read the specs.
 *
 * Usage: pnpm eval:design-benchmark [--case <id>]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
}
// A stale bearer token hijacks auth from the valid SigV4 keys.
process.env.AWS_BEARER_TOKEN_BEDROCK = "";

const { generateObject } = await import("ai");
const { getModel } = await import("../../provider");
const { buildDesignSpecPrompt, buildDesignSpecSystemPrompt } = await import(
  "../../prompts/design-spec"
);
const { designSpecSchema } = await import("../../../design/spec");
const { BENCHMARK_CASES } = await import("./benchmark-cases");
const { scoreSpec, layoutVariety } = await import("./benchmark-score");

/** One brand for every case, so brand data is not a variable. */
const BRAND = {
  name: "Okra Kitchen",
  overview: "A Lagos meal-prep and pastry brand",
  targetAudience: "Busy professionals in Lagos",
  tone: "Warm, direct, never corporate",
  primaryColor: "forest green",
  secondaryColor: "warm cream",
  brandStyle: "warm editorial",
};

const only = process.argv.includes("--case")
  ? process.argv[process.argv.indexOf("--case") + 1]
  : null;
const cases = only
  ? BENCHMARK_CASES.filter((c) => c.id === only)
  : BENCHMARK_CASES;

async function draft(
  testCase: (typeof BENCHMARK_CASES)[number],
  training: boolean,
) {
  const context = {
    title: testCase.id,
    designType: testCase.designType,
    dimensions: testCase.dimensions,
    platform: testCase.platform,
    scheduledFor: null,
    aspectRatio: testCase.aspectRatio,
    briefText: testCase.briefText,
    // biome-ignore lint/suspicious/noExplicitAny: the eval builds a minimal
    // context by hand; the prompt builder reads only these fields.
  } as any;

  const { object } = await generateObject({
    model: getModel("strategy"),
    schema: designSpecSchema,
    system: buildDesignSpecSystemPrompt(BRAND, true, { training }),
    prompt: buildDesignSpecPrompt(context, { training }),
    maxOutputTokens: 4000,
  });
  return object;
}

const rows = [];

for (const testCase of cases) {
  process.stdout.write(`${testCase.id}… `);
  try {
    const [before, after] = await Promise.all([
      draft(testCase, false),
      draft(testCase, true),
    ]);

    const scoredBefore = scoreSpec(before, testCase.designType);
    const scoredAfter = scoreSpec(after, testCase.designType);
    rows.push({
      id: testCase.id,
      before: scoredBefore,
      after: scoredAfter,
      specs: { before, after },
    });

    console.log(
      `headline ${scoredBefore.headlineWords}→${scoredAfter.headlineWords} words ` +
        `(budget ${scoredAfter.headlineBudget}), ` +
        `layout ${scoredBefore.layout}→${scoredAfter.layout}`,
    );
    if (
      scoredBefore.suspectNumbers.length ||
      scoredAfter.suspectNumbers.length
    ) {
      console.log(
        `   invented numbers: before ${scoredBefore.suspectNumbers.length}, after ${scoredAfter.suspectNumbers.length}`,
      );
    }
    if (scoredAfter.placeholders.length) {
      console.log(
        `   placeholders used: ${scoredAfter.placeholders.join(", ")}`,
      );
    }
  } catch (error) {
    console.log(`ERROR ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

const summary = {
  cases: rows.length,
  withinBudget: {
    before: rows.filter((r) => r.before.withinBudget).length,
    after: rows.filter((r) => r.after.withinBudget).length,
  },
  inventedNumbers: {
    before: rows.reduce((n, r) => n + r.before.suspectNumbers.length, 0),
    after: rows.reduce((n, r) => n + r.after.suspectNumbers.length, 0),
  },
  placeholdersUsed: {
    before: rows.reduce((n, r) => n + r.before.placeholders.length, 0),
    after: rows.reduce((n, r) => n + r.after.placeholders.length, 0),
  },
  layoutVariety: {
    before: layoutVariety(rows.map((r) => r.before)),
    after: layoutVariety(rows.map((r) => r.after)),
  },
};

console.log("\n--- totals (before → after) ---");
console.log(
  `headline within format budget: ${summary.withinBudget.before}/${summary.cases} → ${summary.withinBudget.after}/${summary.cases}`,
);
console.log(
  `invented phone-like numbers:   ${summary.inventedNumbers.before} → ${summary.inventedNumbers.after}`,
);
console.log(
  `explicit placeholders:         ${summary.placeholdersUsed.before} → ${summary.placeholdersUsed.after}`,
);
console.log(
  `distinct layouts across cases:  ${summary.layoutVariety.before} → ${summary.layoutVariety.after}`,
);
console.log(
  "\nThese are the measurable parts only. Whether the designs are better is a human call — read the specs in the report.",
);

mkdirSync("qa-reports/benchmarks", { recursive: true });
const path = `qa-reports/benchmarks/design-training-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(path, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
console.log(`report: ${path}`);
