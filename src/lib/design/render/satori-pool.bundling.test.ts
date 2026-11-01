// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Turbopack bundles any file handed to `new Worker()` off a static
 * worker_threads import, magic comments or not, and the bundled render
 * worker throws on load (integration critic round 1: 0 of 5 frames drawn on
 * `next start`). Vitest never bundles, so the render tests cannot see it;
 * this reads the source the bundler reads. scripts/check-build-output.mjs
 * checks the built output itself.
 */
const POOL = readFileSync(
  join(process.cwd(), "src/lib/design/render/satori-pool.ts"),
  "utf8",
);

describe("satori-pool as the bundler sees it", () => {
  it("takes no Worker class from a static import", () => {
    expect(POOL).not.toMatch(
      /^import\s+\{[^}]*\bWorker\b[^}]*\}\s+from\s+"node:worker_threads"/m,
    );
    expect(POOL).not.toMatch(/require\(\s*"node:worker_threads"\s*\)/);
  });

  it("starts the worker from the class taken at run time", () => {
    expect(POOL).toMatch(/process\.getBuiltinModule\("node:worker_threads"\)/);
    expect(POOL).not.toMatch(/new Worker\(/);
  });
});
