// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bundledRuntimeFiles,
  checkBuildOutput,
} from "./check-build-output.mjs";

/* The chunk names Turbopack 16.4 wrote when it bundled the render worker
   (integration critic round 1, job 2281afa3 drew 0 of 5 frames). */
const BUNDLED_WORKER = [
  "chunks/[worker thread]-src_lib_design_render_satori-worker_cjs_13k1dmb8epu96._.js",
  "chunks/src_lib_design_render_satori-worker_cjs_0g6-eg2mcgpoz._.js",
];

describe("bundledRuntimeFiles", () => {
  it("names every chunk the bundler made of the render worker", () => {
    expect(
      bundledRuntimeFiles([...BUNDLED_WORKER, "chunks/ssr/app_page_abc._.js"]),
    ).toEqual(BUNDLED_WORKER);
  });

  it("passes a build that left the worker on disk", () => {
    expect(
      bundledRuntimeFiles([
        "chunks/src_lib_design_render_satori-pool_ts_1a._.js",
        "app/api/design/generate/route.js",
      ]),
    ).toEqual([]);
  });
});

describe("checkBuildOutput", () => {
  let dir;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function serverWith(files, text = {}) {
    dir = await mkdtemp(path.join(tmpdir(), "koos-build-check-"));
    for (const file of files) {
      await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await writeFile(path.join(dir, file), text[file] ?? "");
    }
    return dir;
  }

  /* Integration round 2, LOW 4: the text told the reader to use
     webpackIgnore, which f06259a found Turbopack 16.4.1 ignores. */
  it("fails a build that bundled the worker, naming the fix that works", async () => {
    const result = await checkBuildOutput(await serverWith(BUNDLED_WORKER));
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(2);
    expect(result.problems[0]).toMatch(/process\.getBuiltinModule/);
    expect(result.problems[0]).toMatch(
      /webpackIgnore and turbopackIgnore do not stop/,
    );
    expect(result.problems[0]).not.toMatch(/Pass its path .* webpackIgnore/);
  });

  it("fails a build whose chunk compiled a require into a throw, whatever its name", async () => {
    const chunk = "chunks/ssr/some_renamed_chunk._.js";
    const result = await checkBuildOutput(
      await serverWith([chunk, "app/page.js"], {
        [chunk]: `e.exports=function(){throw Error("Cannot find module as expression is too dynamic")}`,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      expect.stringMatching(
        /^chunks\/ssr\/some_renamed_chunk\._\.js: .*too dynamic/,
      ),
    ]);
  });

  it("passes a build that did not", async () => {
    const result = await checkBuildOutput(
      await serverWith(["app/api/design/generate/route.js"]),
    );
    expect(result).toEqual({ ok: true, problems: [] });
  });

  it("fails when there is no build to check, rather than passing nothing", async () => {
    const result = await checkBuildOutput(
      path.join(tmpdir(), "koos-no-such-build-dir"),
    );
    expect(result.ok).toBe(false);
  });
});
