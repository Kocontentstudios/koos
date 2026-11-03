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

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/* Files loaded by path at run time (new Worker, child_process). A built
   chunk named after one means the bundler took it for its own. */
export const RUNTIME_ONLY_FILES = ["satori-worker"];

/* What Turbopack writes in place of a require it cannot resolve: a chunk
   holding it throws the moment that code runs, whatever the chunk is
   named. */
export const UNRESOLVED_REQUIRE = "as expression is too dynamic";

/* Turbopack 16.4.1 ignores webpackIgnore and turbopackIgnore on a Worker
   path (both tried, f06259a), so the fix named is the one that worked. */
const BUNDLED_FIX =
  'Load it at run time where the bundler cannot follow it: take the Worker class from process.getBuiltinModule("node:worker_threads") as satori-pool.ts does. webpackIgnore and turbopackIgnore do not stop Turbopack 16.4.1.';

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

/** The JavaScript files among `files` whose text holds an unresolved
 *  require (UNRESOLVED_REQUIRE). */
export async function unresolvedRequires(root, files) {
  const found = [];
  for (const file of files) {
    if (!/\.(?:c|m)?js$/.test(file)) continue;
    const text = await readFile(path.join(root, file), "utf8").catch(() => "");
    if (text.includes(UNRESOLVED_REQUIRE)) found.push(file);
  }
  return found;
}

export async function checkBuildOutput(serverDir) {
  const files = await listFiles(serverDir);
  if (files.length === 0) {
    return { ok: false, problems: [`no build output under ${serverDir}`] };
  }
  const bundled = bundledRuntimeFiles(files);
  const unresolved = await unresolvedRequires(serverDir, files);
  const problems = [
    ...bundled.map(
      (file) =>
        `${file}: the bundler compiled a file the server loads from disk. ${BUNDLED_FIX}`,
    ),
    ...unresolved.map(
      (file) =>
        `${file}: the bundler compiled a require it could not resolve into a throw ("${UNRESOLVED_REQUIRE}"); that code fails the first time it runs.`,
    ),
  ];
  return { ok: problems.length === 0, problems };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const serverDir = path.resolve(process.argv[2] ?? ".next/server");
  const { ok, problems } = await checkBuildOutput(serverDir);
  if (!ok) {
    for (const problem of problems)
      console.error(`check-build-output: ${problem}`);
    process.exit(1);
  }
  console.log(
    "check-build-output: no run-time file was bundled, no unresolved require",
  );
}
