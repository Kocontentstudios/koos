/**
 * Detects NEXT_PUBLIC_* variables that are set in the environment but read by
 * no line of source code.
 *
 * Why this exists: every NEXT_PUBLIC_* reader in this repo degrades to a silent
 * no-op when its variable is absent (see posthog-provider.tsx, which returns
 * null and never calls posthog.init). A misspelled variable therefore produces
 * a healthy build, a healthy deploy, and zero data — with no error anywhere.
 * NEXT_PUBLIC_POSTHOG_PROJECT_KEY shipped to production that way and collected
 * nothing until someone opened the dashboard and found it empty.
 *
 * Pure functions here; the fs walk and the process.env read are the only
 * impure parts, and both are injectable so the whole module is testable.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/* Vercel injects these when "Automatically expose System Environment
   Variables" is on. We never set them by hand, and the app is free to ignore
   any of them, so they can never be typos. Matched by prefix rather than an
   enumerated list so a new Vercel system variable can't break the build. */
export const PLATFORM_PREFIXES = ["NEXT_PUBLIC_VERCEL_"];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
const SKIP_DIRECTORIES = new Set(["node_modules", ".next", ".git", "dist"]);

/* Tests quote env reads inside string fixtures. Counting those as real
   references would let a test whitelist a variable the app never reads. */
const TEST_FILE = /\.(test|spec)\.[a-z]+$/;

/* Both the static form Next inlines into the client bundle and the bracket
   form that only works server-side. A variable read either way is live. */
const REFERENCE_PATTERN =
  /process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)|process\.env\[\s*["'`](NEXT_PUBLIC_[A-Z0-9_]+)["'`]\s*\]/g;

export function collectReferencedNames(sources) {
  const referenced = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(REFERENCE_PATTERN)) {
      referenced.add(match[1] ?? match[2]);
    }
  }
  return referenced;
}

export function isPlatformProvided(name) {
  return PLATFORM_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function findOrphans({ referenced, provided }) {
  return [...provided]
    .filter((name) => name.startsWith("NEXT_PUBLIC_"))
    .filter((name) => !isPlatformProvided(name))
    .filter((name) => !referenced.has(name))
    .sort();
}

/* Stripping the shared NEXT_PUBLIC_ prefix keeps it from inflating every
   score — without it, two unrelated names already overlap on two tokens. */
function distinctiveTokens(name) {
  return new Set(
    name
      .replace(/^NEXT_PUBLIC_/, "")
      .split("_")
      .filter(Boolean),
  );
}

const SUGGESTION_THRESHOLD = 0.5;

/**
 * Nearest referenced name by Jaccard similarity over underscore-separated
 * tokens. Edit distance is the wrong tool here: the observed failure inserted
 * a whole word (POSTHOG_PROJECT_KEY vs POSTHOG_KEY), which is 8 characters
 * apart but only one token apart.
 */
export function suggestFor(orphan, referenced) {
  const orphanTokens = distinctiveTokens(orphan);
  let best = null;
  let bestScore = 0;

  for (const candidate of [...referenced].sort()) {
    const candidateTokens = distinctiveTokens(candidate);
    let shared = 0;
    for (const token of orphanTokens) {
      if (candidateTokens.has(token)) shared += 1;
    }
    const union = orphanTokens.size + candidateTokens.size - shared;
    const score = union === 0 ? 0 : shared / union;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return bestScore >= SUGGESTION_THRESHOLD ? best : null;
}

/**
 * The mirror of an orphan: a variable the code reads that the environment does
 * not supply. Renaming the PostHog key silenced analytics; deleting it would
 * silence analytics identically, and the orphan check alone would not notice.
 *
 * Reported only for production deploys. Locally and on previews almost nobody
 * sets every optional variable, and a warning that always fires is ignored.
 */
export function findMissing({ referenced, provided, isProduction }) {
  if (!isProduction) return [];
  return [...referenced].filter((name) => !provided.has(name)).sort();
}

export function describeOrphan(orphan, referenced) {
  const suggestion = suggestFor(orphan, referenced);
  return suggestion
    ? `${orphan} is set but never read — did you mean ${suggestion}?`
    : `${orphan} is set but is read by no source file.`;
}

async function collectSourceFiles(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      files.push(...(await collectSourceFiles(full)));
    } else if (
      SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
      !TEST_FILE.test(entry.name)
    ) {
      files.push(full);
    }
  }
  return files;
}

export async function readReferencedNames(roots) {
  const sources = [];
  for (const root of roots) {
    if (SOURCE_EXTENSIONS.has(path.extname(root))) {
      sources.push(await readFile(root, "utf8").catch(() => ""));
      continue;
    }
    for (const file of await collectSourceFiles(root)) {
      sources.push(await readFile(file, "utf8").catch(() => ""));
    }
  }
  return collectReferencedNames(sources);
}
