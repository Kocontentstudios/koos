// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { LOGO_FILE_FAULTS } from "@/lib/design/render/logo";
import { rasterizeSvg } from "./rasterize";
import {
  RENDERER_IMAGE_BYTE_BUDGET,
  RENDERER_MAX_IMAGE_BYTES,
} from "./reencode";
import { renderInChild } from "./render-in-child";
import {
  noisePng512,
  type SvgAttack,
  svgAttackCorpus,
  tallNoisyLogos,
} from "./svg-attack-fixtures";
import {
  runSvgPathInChild,
  type SvgChildRun,
  type SvgPath,
} from "./svg-attack-in-child";
import { MAX_SVG_INPUT_BYTES, sanitizeSvg } from "./svg-sanitize";

/**
 * FEAT-033 round-4 critic: the SVG sanitiser had been read but never
 * attacked. Every file in the attack corpus goes through each brand-logo
 * path as production runs it, in a child process: the real POST /api/upload
 * and POST /api/brand/logo-colors handlers, and loadBrandLogo followed by a
 * full design through renderCompositeDesign. The child must exit 0, nothing
 * may throw out of a handler, and each file must be refused or drawn as its
 * fixture says.
 */

const PATHS: SvgPath[] = ["upload", "logo-colors", "logo"];

function outcome(path: SvgPath, run: SvgChildRun, name: string): string {
  const r = run.results[name];
  if (!r) return "missing";
  if (r.threw) return `threw ${r.threw}`;
  if (path === "upload") {
    return r.status === 200 ? "accepted" : `refused ${r.status}`;
  }
  if (path === "logo-colors") {
    if (r.status === 200) return r.sentToVisionBytes ? "accepted" : "empty";
    return `refused ${r.status}`;
  }
  if (r.fault) return `refused ${r.fault}`;
  return r.composite === "drawn" ? "accepted" : `accepted ${r.composite}`;
}

function wanted(path: SvgPath, attack: SvgAttack): RegExp {
  if (attack.expect === "drawn") return /^accepted$/;
  if (path === "upload") return /^refused 400$/;
  if (path === "logo-colors") {
    return attack.expect === "not_svg" ? /^refused 415$/ : /^refused 422$/;
  }
  return /^refused /;
}

describe("the SVG attack corpus through every logo path", () => {
  let corpus: SvgAttack[];
  const runs = {} as Record<SvgPath, SvgChildRun>;

  beforeAll(async () => {
    corpus = await svgAttackCorpus();
    for (const path of PATHS) runs[path] = runSvgPathInChild(path, corpus);
  }, 900_000);

  it("covers every attack the critic listed, refused and drawn", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(90);
    expect(corpus.filter((a) => a.expect === "drawn").length).toBeGreaterThan(
      20,
    );
    expect(corpus.filter((a) => a.expect === "refused").length).toBeGreaterThan(
      50,
    );
  });

  it.each(PATHS)("never kills the process: %s", (path) => {
    const run = runs[path];
    expect(
      { status: run.status, signal: run.signal, last: run.lastStarted },
      run.stderr.slice(-2000),
    ).toEqual({ status: 0, signal: null, last: corpus.at(-1)?.name });
    expect(Object.keys(run.results)).toHaveLength(corpus.length);
  });

  it.each(PATHS)("refuses or draws each file as expected: %s", (path) => {
    const wrong = corpus
      .map(
        (attack) => [attack, outcome(path, runs[path], attack.name)] as const,
      )
      .filter(([attack, got]) => !wanted(path, attack).test(got))
      .map(([attack, got]) => `${attack.name} (${attack.expect}): ${got}`);
    expect(wrong).toEqual([]);
  });

  /* The route's own 5 MB cap answers before the sanitiser sees the file. */
  it("tells the uploader why, in the sanitiser's words", () => {
    for (const attack of corpus.filter((a) => a.expect === "refused")) {
      expect(runs.upload.results[attack.name]?.error, attack.name).toMatch(
        attack.bytes.length > MAX_SVG_INPUT_BYTES
          ? /^File too large \(max 5MB\)\.$/
          : /^This SVG can't be used as a logo: /,
      );
    }
  });

  it("reports a refused logo as the file's fault", () => {
    for (const attack of corpus.filter((a) => a.expect !== "drawn")) {
      const fault = runs.logo.results[attack.name]?.fault;
      expect(LOGO_FILE_FAULTS as readonly string[], attack.name).toContain(
        fault,
      );
    }
  });

  /* Round-4 critic C4: a tall noisy logo rasterised to 600 x 4096 encoded
     past the renderer's limit. */
  it("keeps every drawn logo within the renderer's byte budget", () => {
    for (const attack of corpus.filter((a) => a.expect === "drawn")) {
      const bytes = runs.logo.results[attack.name]?.logoBytes ?? 0;
      expect(bytes, attack.name).toBeGreaterThan(0);
      expect(bytes, attack.name).toBeLessThanOrEqual(
        RENDERER_IMAGE_BYTE_BUDGET,
      );
    }
    expect(
      runs.logo.results["tall-noise-tiled-png.svg"]?.logoBytes,
    ).toBeGreaterThan(3_000_000);
  });
});

/* Proof the C4 case can fail: the same tall noisy logos at the box round 4
   rasterised them to are over the renderer's limit, and it throws. */
describe("the tall noisy logos, unbounded", () => {
  it("throw in the renderer at 600 x 4096", async () => {
    const logos = tallNoisyLogos(await noisePng512());
    const rasters = [];
    for (const [name, svg] of Object.entries(logos)) {
      const safe = await sanitizeSvg(new TextEncoder().encode(svg));
      const bytes = await rasterizeSvg(safe, {
        background: "transparent",
        width: 600,
        height: 4096,
      });
      expect(bytes.length, name).toBeGreaterThan(RENDERER_MAX_IMAGE_BYTES);
      rasters.push({ name, contentType: "image/png", bytes });
    }
    const run = renderInChild(rasters);
    expect(run.status, run.stderr.slice(-2000)).toBe(0);
    for (const { name } of rasters) {
      expect(run.verdicts[name], name).toMatch(
        /^threw .*XML parse error: Error domain 1 code 114 /,
      );
    }
  }, 120_000);
});
