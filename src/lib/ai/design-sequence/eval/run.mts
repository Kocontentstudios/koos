/**
 * Periodic eval for the sequence planner (KOOS-AI-002): given a carousel or
 * presentation brief and a frame count, does the outline step then
 * planSequence deliver exactly that many frames, hook first and action
 * last, on one shared palette, with varied layouts and every brief fact on
 * some frame, and does a harsh reader say the hook earns the swipe, the
 * last frame carries the action and the copy never repeats itself?
 *
 * Two lanes per run (rubric Addendum A): AUTO approves planOutline's own
 * outline untouched; APPROVED replaces each point code flagged weak with
 * the fixture's next owner-pool fact (lanes.ts). H13 is gated on APPROVED;
 * AUTO is reported, with the flag recall: of the frames the judge scores
 * 2 or lower for repetition in AUTO, the share code had flagged.
 *
 * Paid lane: per run the outline (brief read and arc), then per lane the
 * production planSequence (brief read, arc, copy, audit, up to two fix
 * calls) and one judge call. Nothing is rendered or stored. Run before
 * shipping a change to src/lib/design/sequence/ or
 * src/lib/ai/prompts/design-sequence.ts, and nightly. Not part of
 * `pnpm test`.
 *
 * Usage: pnpm eval:design-sequence [--set tuning|held-out] [--case <id>]
 *          [--n <3|5|8>] [--kind carousel|presentation] [--no-judge]
 *          [--lane auto|approved|both] [--no-deletes] [--report <path>]
 *        pnpm eval:design-sequence --panel [--report <path>]
 *
 * --panel runs rubric Addendum B's calibration panel instead: the 8
 * fixtures of the frozen reference (reference/expert.json) at its N, our
 * sets planned in lane APPROVED, judged blind and shuffled together with
 * the expert and floor sets, 3 passes each, and gated relative to expert
 * (panel.ts panelGate).
 *
 * --set tuning (the default) runs the briefs the planner is tuned
 * against; --set held-out runs the briefs it was never tuned on,
 * scored and reported on their own, against the same frozen thresholds.
 * A held-out run prints its aggregate only: the plans, faults and judge
 * reasons go to the report file, so whoever tunes the planner from this
 * terminal never reads the briefs it is measured on.
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
const { planOutline } = await import("../../../design/sequence/outline-plan");
const { validateApprovedOutline } = await import(
  "../../../design/sequence/outline-validate"
);
const { profileStatements } = await import("../../../design/sequence/points");
const { namesFree } = await import("../../../design/sequence/hook");
const { OWNER_POOL } = await import("./owner-pool");
const { contentStems } = await import("../../../jobs/directions/text-overlap");
const {
  approvedAsPlanned,
  deletedLeaks,
  FLAG_RECALL_MIN,
  factsTakenOut,
  flagRecall,
  withOwnerPoints,
  withPointDeleted,
} = await import("./lanes");
const { FRAME_BOUNDS } = await import("../../../design/sequence/contract");
const {
  blockingFaults,
  calibrationChecks,
  PANEL_AXES,
  PANEL_GROUPS,
  PANEL_PASSES,
  panelGate,
  panelJobs,
  parseReference,
  REFERENCE_FILES,
  summarizeGroup,
} = await import("./panel");
type PanelGroup = import("./panel").PanelGroup;
type PanelSet = import("./panel").PanelSet;
type PanelJudgment = import("./panel").PanelJudgment;
type Lane = import("./lanes").Lane;
type OwnerEdit = import("./lanes").OwnerEdit;
type PlannedOutline =
  import("../../../design/sequence/contract").PlannedOutline;
const {
  FRAME_COUNTS,
  SEQUENCE_EVAL_CASES,
  SEQUENCE_EVAL_THRESHOLDS,
  SEQUENCE_HELD_OUT_CASES,
} = await import("./cases");
type SequenceEvalCase = import("./cases").SequenceEvalCase;
const { aggregate, failures, labelledFacts, scoreRun } = await import(
  "./score"
);
type RunScore = import("./score").RunScore;
type JudgeScores = import("./score").JudgeScores;
const {
  buildJudgePrompt,
  JUDGE_SYSTEM,
  judgeSchema,
  judgeScores,
  repairJudgeText,
} = await import("./judge");
type PlannedSequence =
  import("../../../design/sequence/contract").PlannedSequence;
type JudgedSet = import("./judge").JudgedSet;

const args = process.argv.slice(2);
const flag = (name: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : null;
const onlyCase = flag("--case");
const onlyN = flag("--n");
const onlyKind = flag("--kind");
const withJudge = !args.includes("--no-judge");
const panelMode = args.includes("--panel");
/* An owner deleting a point is the other half of O5; it is measured on
   its own, unjudged, so the gated lanes stay as Addendum A defines them. */
const withDeletes = !args.includes("--no-deletes");
const laneArg = flag("--lane") ?? "both";
if (!["auto", "approved", "both"].includes(laneArg)) {
  console.error(`--lane is auto, approved or both, not ${laneArg}`);
  process.exit(1);
}
const lanes: Lane[] =
  laneArg === "both" ? ["auto", "approved"] : [laneArg as Lane];
/* H13 is gated on lane APPROVED; a run of AUTO alone gates on AUTO. */
const gatedLane: Lane = lanes.includes("approved") ? "approved" : "auto";
const set = flag("--set") ?? "tuning";
/* The panel holds two held-out fixtures: like a held-out run, it prints
   only aggregates and keeps the planner's trace off the terminal. */
const printRuns = set !== "held-out" && !panelMode;
/* The planner's own trace (design.sequence.planned) carries the plan's
   faults and invented words; a held-out run keeps it off the terminal. */
if (!printRuns) console.info = () => {};
if (set !== "tuning" && set !== "held-out") {
  console.error(`--set is tuning or held-out, not ${set}`);
  process.exit(1);
}
const reportPath =
  flag("--report") ??
  (panelMode
    ? "qa-reports/eval/design-sequence.panel.json"
    : set === "held-out"
      ? "qa-reports/eval/design-sequence.held-out.json"
      : "qa-reports/eval/design-sequence.json");

const cases = (
  set === "held-out" ? SEQUENCE_HELD_OUT_CASES : SEQUENCE_EVAL_CASES
).filter(
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
  plan: JudgedSet,
): Promise<{
  scores: JudgeScores;
  why: Record<string, string>;
  frames: { frame: number; repetition: number }[];
} | null> {
  try {
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema: judgeSchema,
      system: JUDGE_SYSTEM,
      maxOutputTokens: 1000,
      prompt: buildJudgePrompt(c, plan),
      experimental_repairText: repairJudgeText,
    });
    return {
      scores: judgeScores(object),
      why: {
        hook: object.hook.why,
        lastAction: object.lastAction.why,
        nonRepetitive: object.nonRepetitive.why,
      },
      frames: object.frames,
    };
  } catch (err) {
    console.error(`judge failed on ${c.id}`, err);
    return null;
  }
}

interface RunRecord {
  lane: Lane;
  label: string;
  score: RunScore | null;
  judge: Awaited<ReturnType<typeof judge>>;
  plan: PlannedSequence | null;
  outline: PlannedOutline | null;
  /** Lane APPROVED: the flagged points the owner pool replaced. */
  edits: OwnerEdit[];
  /** Replaced points a delivered frame still makes (O5). */
  leaks: string[];
  modelCalls: number;
  repaired: boolean;
  /** Copy faults the planner could not get rewritten (plan.ts copyFaults):
   *  a flat hook or a line said twice that ships, counted, not hidden. */
  faults: string[];
  /** Words no source vouches for that shipped (PlannedSequenceResult). */
  invented: string[];
  /** Facts code wrote into a footer because the copy left them out. */
  factsDrawn: string[];
  /** Fixture facts the owner's edits took out (factsTakenOut), not asked
   *  of any frame. */
  released?: string[];
  /** Blocking faults still on the set: production refuses such a set
   *  (SequenceShipRefusedError) before any render; the eval scores it and
   *  counts it. */
  refused?: string[];
  /** Frames code rewrote from their own point (last-resort.ts). */
  lastResort?: string[];
  ms: number;
  error?: string;
}

/* Three jobs at a time, each running its lanes in turn: enough to finish
   in minutes without tripping the provider's rate limit. */
const CONCURRENCY = 3;

if (panelMode) process.exit(await runPanel());

interface PanelOurs {
  fixtureId: string;
  set: PanelSet | null;
  blocking: string[];
  error?: string;
}

/** Rubric Addendum B's panel: our sets planned at the reference's N in
 *  lane APPROVED, then every group's sets judged blind in one shuffled
 *  order. Returns the exit code. */
async function runPanel(): Promise<number> {
  const reference = {
    expert: parseReference(readFileSync(REFERENCE_FILES.expert, "utf8")),
    floor: parseReference(readFileSync(REFERENCE_FILES.floor, "utf8")),
  };
  const allCases = [...SEQUENCE_EVAL_CASES, ...SEQUENCE_HELD_OUT_CASES];
  const caseOf = (id: string) => {
    const c = allCases.find((x) => x.id === id);
    if (!c) throw new Error(`no fixture ${id}`);
    return c;
  };
  const fixtureIds = reference.expert.map((s) => s.fixtureId);

  const ours: PanelOurs[] = [];
  let nextPlan = 0;
  async function planWorker() {
    while (nextPlan < reference.expert.length) {
      const expert = reference.expert[nextPlan++];
      const c = caseOf(expert.fixtureId);
      const n = expert.frames.length;
      try {
        const planned = await planOutline({
          context: contextOf(c),
          kind: c.kind,
          frameCount: n,
          memorySummary: "",
        });
        const { result } = await planLane(c, "approved", planned.outline);
        ours.push({
          fixtureId: c.id,
          set: { fixtureId: c.id, kind: c.kind, frames: result.plan.frames },
          blocking: blockingFaults({
            frameCount: n,
            plannedFrames: result.plan.frames.length,
            refused: result.refused,
            problems: result.problems,
          }),
        });
      } catch (err) {
        ours.push({
          fixtureId: c.id,
          set: null,
          blocking: [],
          error: String(err),
        });
      }
      console.log(`panel: planned ${ours.length} of ${fixtureIds.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, planWorker));

  const setsOf: Record<PanelGroup, Map<string, PanelSet>> = {
    expert: new Map(reference.expert.map((s) => [s.fixtureId, s])),
    floor: new Map(reference.floor.map((s) => [s.fixtureId, s])),
    ours: new Map(
      ours.flatMap((o) => (o.set ? [[o.fixtureId, o.set] as const] : [])),
    ),
  };
  const jobs = panelJobs(fixtureIds, PANEL_PASSES, Math.random);
  const judgments: (PanelJudgment & {
    order: number;
    why: Record<string, string> | null;
  })[] = [];
  let nextJudge = 0;
  async function judgeWorker() {
    while (nextJudge < jobs.length) {
      const order = nextJudge++;
      const job = jobs[order];
      const set = setsOf[job.group].get(job.fixtureId);
      const c = caseOf(job.fixtureId);
      /* One retry: a transient provider error would otherwise drop a
         judgment and skew the means. */
      const verdict = set
        ? ((await judge(c, set)) ?? (await judge(c, set)))
        : null;
      judgments.push({
        ...job,
        order,
        scores: verdict?.scores ?? null,
        why: verdict?.why ?? null,
      });
      console.log(`panel: judged ${judgments.length} of ${jobs.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, judgeWorker));

  const summary = Object.fromEntries(
    PANEL_GROUPS.map((g) => [g, summarizeGroup(judgments, g)]),
  ) as Record<PanelGroup, ReturnType<typeof summarizeGroup>>;
  const blockingShipped = ours.reduce((n, o) => n + o.blocking.length, 0);
  const planFailures = ours.filter((o) => !o.set).length;
  const gate = panelGate({ summary, blockingFaultsShipped: blockingShipped });
  if (planFailures > 0) {
    gate.push({
      name: "every set planned",
      pass: false,
      detail: `${planFailures} of ${fixtureIds.length} threw`,
    });
  }
  const calibration = calibrationChecks(summary);

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(
    reportPath,
    JSON.stringify(
      { mode: "panel", summary, gate, calibration, ours, judgments },
      null,
      2,
    ),
  );

  const cell = (x: number | null) => (x === null ? " n/a" : x.toFixed(2));
  console.log(
    `\npanel: ${fixtureIds.length} fixtures x ${PANEL_PASSES} passes, blind and shuffled`,
  );
  console.log(`group   ${PANEL_AXES.join("  ")}  (within-set sd)`);
  for (const g of PANEL_GROUPS) {
    const s = summary[g];
    console.log(
      `${g.padEnd(7)} ${PANEL_AXES.map((a) => cell(s.means[a])).join(" ")}  (${PANEL_AXES.map((a) => cell(s.withinSd[a])).join(" ")}) judged ${s.judged}, failed ${s.failed}`,
    );
  }
  console.log(
    `blocking faults shipped on our sets: ${blockingShipped} across ${ours.filter((o) => o.blocking.length > 0).length} of ${ours.length}`,
  );
  console.log("\njudge calibration (Addendum B acceptance of the judge):");
  for (const c of calibration) {
    console.log(`  ${c.pass ? "PASS" : "FAIL"} ${c.name}: ${c.detail}`);
  }
  console.log("\nAddendum B gate:");
  for (const c of gate) {
    console.log(`  ${c.pass ? "PASS" : "FAIL"} ${c.name}: ${c.detail}`);
  }
  console.log(`report: ${reportPath}`);
  const passed = gate.every((c) => c.pass);
  console.log(passed ? "PASS" : "FAIL");
  return passed ? 0 : 1;
}

const records: RunRecord[] = [];
const jobs = cases.flatMap((c) => counts.map((n) => ({ c, n })));
const totalRuns = jobs.length * lanes.length;

function threw(lane: Lane, label: string, started: number, err: unknown) {
  records.push({
    lane,
    label,
    score: null,
    judge: null,
    plan: null,
    outline: null,
    edits: [],
    leaks: [],
    modelCalls: 0,
    repaired: false,
    faults: [],
    invented: [],
    factsDrawn: [],
    ms: Date.now() - started,
    error: String(err),
  });
  console.error(
    printRuns ? `${label} [${lane}]: threw` : "a run threw",
    printRuns ? err : (err as Error)?.name,
  );
}

/* Where and when are every frame's to mention, so a removed point that
   gave them leaks nothing when the action frame gives them. */
function sharedWords(c: SequenceEvalCase): Set<string> {
  return new Set([
    ...namesFree(c.brand.name, c.offering),
    ...c.facts
      .filter((f) =>
        ["date", "day", "time", "place", "contact"].includes(f.kind),
      )
      .flatMap((f) => [...contentStems(f.text)]),
  ]);
}

/** The set one lane delivers from the outline: AUTO approves it as
 *  planned, APPROVED swaps each flagged point for the owner pool's next. */
async function planLane(
  c: SequenceEvalCase,
  lane: Lane,
  outline: PlannedOutline,
) {
  const { approved, edits } =
    lane === "auto"
      ? { approved: approvedAsPlanned(outline), edits: [] as OwnerEdit[] }
      : withOwnerPoints(outline, OWNER_POOL[c.id] ?? []);
  const valid = validateApprovedOutline(approved, {
    kind: c.kind,
    briefText: c.request.briefText,
    profileStatements: profileStatements(c.brand),
  });
  if (!valid.ok) {
    throw new Error(
      `outline refused: ${valid.problems.map((p) => p.detail).join("; ")}`,
    );
  }
  const result = await planSequence(
    {
      context: contextOf(c),
      kind: c.kind,
      frameCount: valid.outline.points.length,
      imageSource: c.imageSource,
      image: null,
      memorySummary: "",
      recentLayouts: [],
      approvedOutline: valid.outline,
    },
    { onBlocked: "report" },
  );
  return { result, edits, valid };
}

async function runLane(
  c: SequenceEvalCase,
  n: number,
  lane: Lane,
  outline: PlannedOutline,
  outlineCalls: number,
) {
  const label = `${c.id}/${n}`;
  const started = Date.now();
  try {
    const { result, edits, valid } = await planLane(c, lane, outline);
    const released = factsTakenOut(labelledFacts(c), valid.outline, edits);
    const score = scoreRun(c, n, result.plan, released);
    const verdict = withJudge ? await judge(c, result.plan) : null;
    const leaks = deletedLeaks(
      result.plan,
      valid.outline,
      edits,
      sharedWords(c),
    );
    records.push({
      lane,
      label,
      score,
      judge: verdict,
      plan: result.plan,
      outline,
      edits,
      leaks,
      modelCalls: result.modelCalls + outlineCalls,
      repaired: result.repaired,
      faults: result.faults.map((f) => `frame ${f.frame + 1}: ${f.detail}`),
      invented: result.invented.map((i) => `frame ${i.frame + 1}: ${i.text}`),
      factsDrawn: result.factsDrawn,
      released,
      refused: result.refused.map((f) => `frame ${f.frame + 1}: ${f.detail}`),
      lastResort: result.lastResort,
      ms: Date.now() - started,
    });
    if (!printRuns) {
      console.log(`run ${records.length} of ${totalRuns} done`);
      return;
    }
    const marks = [
      score.count,
      score.roles,
      score.paletteShared,
      score.layoutVariety,
      score.titleClean,
      score.factCoverage,
    ]
      .map((ok) => (ok ? "ok" : "FAIL"))
      .join(" ");
    const judged = verdict
      ? ` judge ${verdict.scores.hook}/${verdict.scores.lastAction}/${verdict.scores.nonRepetitive}`
      : "";
    console.log(
      `${label} [${lane}]: ${marks}${judged} calls=${result.modelCalls}${result.repaired ? " repaired" : ""} faults=${result.faults.length} edits=${edits.length} ${Date.now() - started}ms`,
    );
    for (const fault of result.faults) {
      console.log(`  fault: frame ${fault.frame + 1}: ${fault.detail}`);
    }
    for (const made of result.invented) {
      console.log(`  invented: frame ${made.frame + 1}: ${made.text}`);
    }
    for (const drawn of result.factsDrawn) {
      console.log(`  fact drawn by code: ${drawn}`);
    }
    for (const leak of leaks) console.log(`  removed point leaked: ${leak}`);
    for (const r of result.refused) {
      console.log(`  would refuse: frame ${r.frame + 1}: ${r.detail}`);
    }
    for (const r of result.lastResort) console.log(`  last resort: ${r}`);
    if (score.uncovered.length > 0) {
      console.log(`  uncovered: ${score.uncovered.join(" | ")}`);
    }
    if (!score.offeringOnHook) console.log("  hook does not name the offering");
  } catch (err) {
    threw(lane, label, started, err);
  }
}

interface DeletionRecord {
  label: string;
  deleted: string;
  /** Frames that still make the deleted point. */
  leaks: string[];
  error?: string;
}
const deletions: DeletionRecord[] = [];

/** The planner's outline with one body point deleted: does any delivered
 *  frame still make it (O5)? */
async function runDeletion(
  c: SequenceEvalCase,
  n: number,
  outline: PlannedOutline,
) {
  const label = `${c.id}/${n}`;
  const cut = withPointDeleted(outline, FRAME_BOUNDS[c.kind].min);
  if (!cut) return;
  try {
    const valid = validateApprovedOutline(cut.approved, {
      kind: c.kind,
      briefText: c.request.briefText,
      profileStatements: profileStatements(c.brand),
    });
    if (!valid.ok) throw new Error("outline refused");
    const result = await planSequence(
      {
        context: contextOf(c),
        kind: c.kind,
        frameCount: valid.outline.points.length,
        imageSource: c.imageSource,
        image: null,
        memorySummary: "",
        recentLayouts: [],
        approvedOutline: valid.outline,
      },
      { onBlocked: "report" },
    );
    const leaks = deletedLeaks(
      result.plan,
      valid.outline,
      [cut.deleted],
      sharedWords(c),
    );
    deletions.push({ label, deleted: cut.deleted.from, leaks });
    if (printRuns) {
      console.log(
        `${label} [delete "${cut.deleted.from}"]: ${leaks.length === 0 ? "not said" : leaks.join("; ")}`,
      );
    }
  } catch (err) {
    deletions.push({
      label,
      deleted: cut.deleted.from,
      leaks: [],
      error: String(err),
    });
  }
}

let next = 0;
async function worker() {
  while (next < jobs.length) {
    const { c, n } = jobs[next++];
    const started = Date.now();
    let planned: Awaited<ReturnType<typeof planOutline>>;
    try {
      planned = await planOutline({
        context: contextOf(c),
        kind: c.kind,
        frameCount: n,
        memorySummary: "",
      });
    } catch (err) {
      for (const lane of lanes) threw(lane, `${c.id}/${n}`, started, err);
      continue;
    }
    if (printRuns) {
      console.log(`${c.id}/${n} outline:`);
      for (const p of planned.outline.points) {
        console.log(
          `  ${p.id} ${p.role} [${p.source}] ${p.point}${p.weak ? `  <${p.weak.kind}>` : ""}`,
        );
      }
    }
    for (const lane of lanes) {
      await runLane(c, n, lane, planned.outline, planned.modelCalls);
    }
    if (withDeletes) await runDeletion(c, n, planned.outline);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

/* A run the planner threw on scores zero on every deterministic check: it
   delivered nothing. */
const scoreOf = (r: RunRecord, i: number): RunScore =>
  r.score ?? {
    caseId: `error-${i}`,
    frames: 0,
    count: false,
    roles: false,
    paletteShared: false,
    layoutVariety: false,
    titleClean: false,
    factCoverage: false,
    uncovered: [],
    offeringOnHook: false,
    problems: [r.error ?? "threw"],
  };

const byLane = Object.fromEntries(
  lanes.map((lane) => {
    const runs = records.filter((r) => r.lane === lane);
    return [
      lane,
      aggregate(
        runs.map(scoreOf),
        runs.flatMap((r) => (r.judge ? [r.judge.scores] : [])),
      ),
    ];
  }),
) as Record<Lane, ReturnType<typeof aggregate>>;

const recall = flagRecall(
  records.flatMap((r) =>
    r.lane === "auto" && r.judge && r.outline
      ? [{ label: r.label, frameScores: r.judge.frames, outline: r.outline }]
      : [],
  ),
);

const failed = [
  ...failures(byLane[gatedLane])
    .filter((f) => withJudge || !f.endsWith("not measured"))
    .map((f) => `[${gatedLane}] ${f}`),
  ...(lanes.includes("auto") &&
  withJudge &&
  recall.recall !== null &&
  recall.recall < FLAG_RECALL_MIN
    ? [`flag recall ${recall.recall.toFixed(2)} < ${FLAG_RECALL_MIN}`]
    : []),
];

mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(
  reportPath,
  JSON.stringify(
    {
      set,
      gatedLane,
      aggregate: byLane,
      recall,
      deletions,
      thresholds: SEQUENCE_EVAL_THRESHOLDS,
      records,
    },
    null,
    2,
  ),
);
for (const lane of lanes) {
  const runs = records.filter((r) => r.lane === lane);
  const across = (
    key:
      | "faults"
      | "invented"
      | "factsDrawn"
      | "leaks"
      | "refused"
      | "lastResort",
  ) =>
    `${runs.reduce((n, r) => n + (r[key]?.length ?? 0), 0)} across ${runs.filter((r) => (r[key]?.length ?? 0) > 0).length} of ${runs.length} runs`;
  console.log(
    `\nset: ${set}, lane ${lane}${lane === gatedLane ? " (gated)" : ""}`,
    byLane[lane],
  );
  console.log(`copy faults left: ${across("faults")}`);
  console.log(`invented words shipped: ${across("invented")}`);
  console.log(`facts drawn by code: ${across("factsDrawn")}`);
  console.log(
    `blocking faults left (production refuses these sets before any render): ${across("refused")}`,
  );
  console.log(`frames code rewrote from their point: ${across("lastResort")}`);
  if (lane === "approved") {
    console.log(
      `owner edits: ${runs.reduce((n, r) => n + r.edits.length, 0)}; removed points leaked: ${across("leaks")}`,
    );
  }
}
if (lanes.includes("auto") && withJudge) {
  console.log(
    `flag recall (AUTO frames the judge scored <= 2 for repetition that code flagged): ${recall.flagged} of ${recall.low}${recall.recall === null ? "" : ` = ${recall.recall.toFixed(2)}`}`,
  );
  console.log(
    `flag rate: ${recall.bodyFlagged} of ${recall.bodyPoints} body points flagged; precision (flagged body points the judge scored <= 2): ${recall.precision === null ? "n/a" : recall.precision.toFixed(2)}; unflagged body points scored <= 2: ${recall.unflaggedLow === null ? "n/a" : recall.unflaggedLow.toFixed(2)}`,
  );
  if (printRuns) for (const m of recall.missed) console.log(`  missed: ${m}`);
}
if (withDeletes) {
  const leaked = deletions.filter((d) => d.leaks.length > 0);
  const errored = deletions.filter((d) => d.error).length;
  console.log(
    `deleted points said anyway: ${leaked.length} of ${deletions.length - errored} runs${errored ? ` (${errored} threw)` : ""}`,
  );
  if (printRuns) {
    for (const d of leaked) console.log(`  ${d.label}: ${d.leaks.join("; ")}`);
  }
}
console.log(`report: ${reportPath}`);
if (failed.length > 0) {
  console.error(`FAIL\n- ${failed.join("\n- ")}`);
  process.exit(1);
}
console.log(withJudge ? "PASS" : "PASS (deterministic lane only)");
