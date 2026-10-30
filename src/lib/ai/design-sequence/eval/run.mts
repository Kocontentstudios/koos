/**
 * Periodic eval for the sequence planner (KOOS-AI-002): given a carousel or
 * presentation brief and a frame count, does planSequence deliver exactly
 * that many frames, hook first and action last, on one shared palette, with
 * varied layouts and every brief fact on some frame, and does a harsh
 * reader say the hook earns the swipe, the last frame carries the action
 * and the copy never repeats itself?
 *
 * Paid lane: per run the brief read, the outline, the copy and (when
 * needed) the repair pass, then one judge call. Runs the production
 * planSequence; nothing is rendered or stored. Run before shipping a change
 * to src/lib/design/sequence/ or src/lib/ai/prompts/design-sequence.ts, and
 * nightly. Not part of `pnpm test`.
 *
 * Usage: pnpm eval:design-sequence [--case <id>] [--n <3|5|8>]
 *          [--kind carousel|presentation] [--no-judge]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
// A stale bearer token hijacks auth from the valid SigV4 keys and fails every
// call with "Forbidden".
process.env.AWS_BEARER_TOKEN_BEDROCK = "";

const { generateObject } = await import("ai");
const { getModel } = await import("../../provider");
const { planSequence } = await import("../../../design/sequence/plan");
const { FRAME_COUNTS, SEQUENCE_EVAL_CASES, SEQUENCE_EVAL_THRESHOLDS } =
  await import("./cases");
type SequenceEvalCase = import("./cases").SequenceEvalCase;
const { aggregate, failures, scoreRun } = await import("./score");
type RunScore = import("./score").RunScore;
type JudgeScores = import("./score").JudgeScores;
const { buildJudgePrompt, JUDGE_SYSTEM, judgeSchema, judgeScores } =
  await import("./judge");
type PlannedSequence =
  import("../../../design/sequence/contract").PlannedSequence;

const args = process.argv.slice(2);
const flag = (name: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : null;
const onlyCase = flag("--case");
const onlyN = flag("--n");
const onlyKind = flag("--kind");
const withJudge = !args.includes("--no-judge");
const reportPath = "qa-reports/eval/design-sequence.json";

const cases = SEQUENCE_EVAL_CASES.filter(
  (c) => (!onlyCase || c.id === onlyCase) && (!onlyKind || c.kind === onlyKind),
);
const counts = onlyN ? [Number(onlyN)] : [...FRAME_COUNTS];
if (cases.length === 0 || counts.some((n) => !Number.isInteger(n))) {
  console.error("No cases match the filters");
  process.exit(1);
}

function contextOf(c: SequenceEvalCase) {
  return {
    source: "quick",
    brand: {
      id: `eval-${c.id}`,
      name: c.brand.name,
      logoUrl: c.hasLogo ? "https://example.invalid/logo.png" : null,
    },
    brandSummary: c.brand,
    briefId: null,
    calendarItemId: null,
    attachments: [],
    title: c.request.title,
    briefText: c.request.briefText,
    designType: c.request.designType,
    dimensions: null,
    aspectRatio: c.request.aspectRatio,
    platform: c.request.platform,
    scheduledFor: null,
    referenceUrls: [],
    logoAssetUrls: [],
    logoCandidates: [],
  } as never;
}

async function judge(
  c: SequenceEvalCase,
  plan: PlannedSequence,
): Promise<{ scores: JudgeScores; why: Record<string, string> } | null> {
  try {
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema: judgeSchema,
      system: JUDGE_SYSTEM,
      maxOutputTokens: 1000,
      prompt: buildJudgePrompt(c, plan),
    });
    return {
      scores: judgeScores(object),
      why: {
        hook: object.hook.why,
        lastAction: object.lastAction.why,
        nonRepetitive: object.nonRepetitive.why,
      },
    };
  } catch (err) {
    console.error(`judge failed on ${c.id}`, err);
    return null;
  }
}

interface RunRecord {
  score: RunScore | null;
  judge: Awaited<ReturnType<typeof judge>>;
  plan: PlannedSequence | null;
  modelCalls: number;
  repaired: boolean;
  ms: number;
  error?: string;
}

const records: RunRecord[] = [];
const jobs = cases.flatMap((c) => counts.map((n) => ({ c, n })));

/* Three at a time: enough to finish 18 runs in minutes without tripping
   the provider's rate limit. */
const CONCURRENCY = 3;
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const { c, n } = jobs[next++];
    const started = Date.now();
    try {
      const result = await planSequence({
        context: contextOf(c),
        kind: c.kind,
        frameCount: n,
        imageSource: c.imageSource,
        image: null,
        memorySummary: "",
        recentLayouts: [],
      });
      const score = scoreRun(c, n, result.plan);
      const verdict = withJudge ? await judge(c, result.plan) : null;
      records.push({
        score,
        judge: verdict,
        plan: result.plan,
        modelCalls: result.modelCalls,
        repaired: result.repaired,
        ms: Date.now() - started,
      });
      const marks = [
        score.count,
        score.roles,
        score.paletteShared,
        score.layoutVariety,
        score.factCoverage,
      ]
        .map((ok) => (ok ? "ok" : "FAIL"))
        .join(" ");
      const judged = verdict
        ? ` judge ${verdict.scores.hook}/${verdict.scores.lastAction}/${verdict.scores.nonRepetitive}`
        : "";
      console.log(
        `${c.id} N=${n}: ${marks}${judged} calls=${result.modelCalls}${result.repaired ? " repaired" : ""} ${Date.now() - started}ms`,
      );
      if (score.uncovered.length > 0) {
        console.log(`  uncovered: ${score.uncovered.join(" | ")}`);
      }
      if (!score.offeringOnHook)
        console.log("  hook does not name the offering");
    } catch (err) {
      records.push({
        score: null,
        judge: null,
        plan: null,
        modelCalls: 0,
        repaired: false,
        ms: Date.now() - started,
        error: String(err),
      });
      console.error(`${c.id} N=${n}: planner threw`, err);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

/* A run the planner threw on scores zero on every deterministic check: it
   delivered nothing. */
const scores = records.map(
  (r, i) =>
    r.score ?? {
      caseId: `error-${i}`,
      frames: 0,
      count: false,
      roles: false,
      paletteShared: false,
      layoutVariety: false,
      factCoverage: false,
      uncovered: [],
      offeringOnHook: false,
      problems: [r.error ?? "threw"],
    },
);
const judged = records.flatMap((r) => (r.judge ? [r.judge.scores] : []));
const agg = aggregate(scores, judged);
const failed = failures(agg).filter(
  (f) => withJudge || !f.endsWith("not measured"),
);

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(
  reportPath,
  JSON.stringify(
    { aggregate: agg, thresholds: SEQUENCE_EVAL_THRESHOLDS, records },
    null,
    2,
  ),
);
console.log("\n", agg);
console.log(`report: ${reportPath}`);
if (failed.length > 0) {
  console.error(`FAIL\n- ${failed.join("\n- ")}`);
  process.exit(1);
}
console.log(withJudge ? "PASS" : "PASS (deterministic lane only)");
