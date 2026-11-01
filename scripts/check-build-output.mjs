/**
 * Fails the build when the bundler has swallowed a file the server starts
 * from disk at run time.
 *
 * Why this exists: satori-pool.ts starts its render worker from a path.
 * Turbopack can read that path, so it bundled the worker as an entry and
 * compiled the worker's run-time require of next/og into
 * `throw Error("Cannot find module as expression is too dynamic")`. Every
 * test passed (vitest never bundles), the build passed, and no design drew a
 * single pixel on `next start`. The only place the defect is visible before
 * a user meets it is the build output, so it is checked there.
 *
 * Pure functions here; the directory walk is the only impure part and takes
 * its root as an argument, so the whole module is testable.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/* Files loaded by path at run time (new Worker, child_process). A built
   chunk named after one means the bundler took it for its own. */
export const RUNTIME_ONLY_FILES = ["satori-worker"];

export function bundledRuntimeFiles(chunkNames) {
  return chunkNames.filter((name) =>
    RUNTIME_ONLY_FILES.some((file) => name.includes(file)),
  );
}

async function listFiles(root) {
  const found = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else found.push(path.relative(root, full));
    }
  }
  await walk(root);
  return found;
}

export async function checkBuildOutput(serverDir) {
  const files = await listFiles(serverDir);
  if (files.length === 0) {
    return { ok: false, problems: [`no build output under ${serverDir}`] };
  }
  const bundled = bundledRuntimeFiles(files);
  return {
    ok: bundled.length === 0,
    problems: bundled.map(
      (file) =>
        `${file}: the bundler compiled a file the server loads from disk. Pass its path to new Worker() with /* webpackIgnore: true */ (see satori-pool.ts).`,
    ),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const serverDir = path.resolve(process.argv[2] ?? ".next/server");
  const { ok, problems } = await checkBuildOutput(serverDir);
  if (!ok) {
    for (const problem of problems)
      console.error(`check-build-output: ${problem}`);
    process.exit(1);
  }
  console.log("check-build-output: no run-time file was bundled");
}
