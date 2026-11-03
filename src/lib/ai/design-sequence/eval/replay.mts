/**
 * Replays every last resort an eval run captured
 * (`<report>.snapshots.jsonl`, run.mts) against the last-resort.ts in this
 * checkout, with no model call: how many sets came in carrying a blocking
 * fault, how many code now clears, and what is left. Run it before and
 * after a change to last-resort.ts or faults.ts on the same snapshots.
 *
 * Usage: npx tsx src/lib/ai/design-sequence/eval/replay.mts <snapshots.jsonl>
 *          [--show] [--frames]
 */

import { readFileSync } from "node:fs";

const { lastResort } = await import("../../../design/sequence/last-resort");
const { blockingFaults, setFaults } = await import(
  "../../../design/sequence/faults"
);
const { withConsistentCasing } = await import(
  "../../../design/sequence/casing"
);
const { withSettledTitles } = await import("../../../design/sequence/title");
const { withFigureLayout } = await import("../../../design/sequence/layouts");
type LastResortInput = import("../../../design/sequence/plan").LastResortInput;
type FrameBeat = import("../../../design/sequence/contract").FrameBeat;

const revive = (_: string, value: unknown) => {
  if (value && typeof value === "object") {
    if ("$map" in value) return new Map((value as { $map: [] }).$map);
    if ("$set" in value) return new Set((value as { $set: [] }).$set);
  }
  return value;
};

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error("usage: replay.mts <snapshots.jsonl> [--show] [--frames]");
  process.exit(1);
}
const show = flags.includes("--show");
const rows = readFileSync(file, "utf8")
  .trim()
  .split("\n")
  .map(
    (line) =>
      JSON.parse(line, revive) as {
        case: string;
        n: number;
        lane: string;
        snapshot: LastResortInput;
      },
  );

let carrying = 0;
let cleared = 0;
let before = 0;
let after = 0;
let slowest = { ms: 0, at: "" };
const left: string[] = [];
for (const { case: id, n, lane, snapshot: s } of rows) {
  const faults = blockingFaults(setFaults(s.plan, s.rules));
  if (faults.length === 0) continue;
  carrying += 1;
  before += faults.length;
  const tidy = (frames: readonly FrameBeat[]) =>
    withConsistentCasing(
      withSettledTitles(frames, s.titleRules, s.arcTitles),
      s.casingSources,
    ).frames.map(withFigureLayout);
  const started = Date.now();
  const result = lastResort(s.plan, s.rules, s.claims, tidy, s.alternates);
  const ms = Date.now() - started;
  if (ms > slowest.ms) slowest = { ms, at: `${id}/${n} ${lane}` };
  after += result.blocking.length;
  if (result.blocking.length === 0) cleared += 1;
  for (const f of result.blocking) {
    left.push(`${id}/${n} ${lane} frame ${f.frame + 1}: ${f.detail}`);
  }
  if (show) {
    console.log(
      `== ${id}/${n} ${lane}: ${faults.length} -> ${result.blocking.length}`,
    );
    for (const a of result.applied) console.log(`   applied ${a}`);
    if (flags.includes("--frames")) {
      result.plan.frames.forEach((f, i) => {
        console.log(
          `   F${i + 1} ${f.headline} | ${f.subheadline} | ${f.footerLines.join(" / ")}`,
        );
      });
    }
  }
}
console.log(
  `snapshots ${rows.length}, carrying a blocking fault ${carrying}: cleared ${cleared}, left ${carrying - cleared}; faults ${before} -> ${after}; slowest ${slowest.ms}ms (${slowest.at})`,
);
for (const line of left) console.log(`  left: ${line.slice(0, 200)}`);
