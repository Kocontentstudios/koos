// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  photographicCutoutPng,
  progressiveQ100NoiseJpeg,
} from "@/lib/images/large-image-fixtures";

/**
 * The spec's budget for one loadDesignImage (Upload, "What a load costs"):
 * under 2 s and 512 MB. Round-4 critic C1 measured the progressive q100
 * noise JPEG at 1.84 to 2.57 s and 517 to 534 MB. Each load runs in a fresh
 * process (load-budget-child.mts) so its peak RSS is its own.
 *
 * Time is gated as CPU time: the suite saturates every core while this
 * runs, and wall time then measures the neighbours. Measured unloaded, the
 * costliest case here takes 0.45 to 0.75 s of wall time and 0.6 to 0.8 s of
 * CPU, and peaks at 216 to 233 MB.
 */

const MAX_PEAK_RSS_MB = 512;
const MAX_CPU_MS = 2_000;

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CHILD = fileURLToPath(
  new URL("./load-budget-child.mts", import.meta.url),
);

interface LoadCost {
  outcome: string;
  wallMs: number;
  cpuMs: number;
  peakRssMB: number;
}

function loadInChild(file: string, ext: "png" | "jpg"): LoadCost {
  const run = spawnSync(
    process.execPath,
    ["--import", "tsx", CHILD, file, ext],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000 },
  );
  if (run.status !== 0) throw new Error(run.stderr.slice(-2000));
  return JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "");
}

describe("one design-image load stays inside the spec's budget", () => {
  let dir: string;
  const cases: { name: string; ext: "png" | "jpg"; outcome: RegExp }[] = [
    /* Full-range noise is a busy texture to the local-contrast measure
       (round 7), so it is accepted and its re-encode is the stored one. */
    {
      name: "noise-2560-q100-prog.jpg",
      ext: "jpg",
      outcome: /^accepted /,
    },
    {
      name: "noise-2560-q100-prog-with-subject.jpg",
      ext: "jpg",
      outcome: /^accepted /,
    },
    { name: "cutout-2560-rgba.png", ext: "png", outcome: /^accepted / },
  ];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "load-budget-"));
    writeFileSync(join(dir, cases[0].name), await progressiveQ100NoiseJpeg());
    writeFileSync(
      join(dir, cases[1].name),
      await progressiveQ100NoiseJpeg({ withSubject: true }),
    );
    writeFileSync(join(dir, cases[2].name), await photographicCutoutPng(2560));
  }, 60_000);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.each(cases)(
    "$name",
    ({ name, ext, outcome }) => {
      const cost = loadInChild(join(dir, name), ext);
      expect(cost.outcome).toMatch(outcome);
      expect(cost.peakRssMB, JSON.stringify(cost)).toBeLessThan(
        MAX_PEAK_RSS_MB,
      );
      expect(cost.cpuMs, JSON.stringify(cost)).toBeLessThan(MAX_CPU_MS);
    },
    90_000,
  );
});
