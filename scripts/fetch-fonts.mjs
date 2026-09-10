/**
 * Vendors the three render faces into src/lib/design/render/fonts/ before
 * `next build` (see package.json "build").
 *
 * Why this exists: src/lib/design/render/fonts.ts reads those files and only
 * falls back to fonts.googleapis.com when they are absent. Nothing ever
 * created the directory, so the fallback was the ONLY path — every production
 * cold start fetched three fonts from Google, and a Google outage left satori
 * with no fonts at all, which fails every design render.
 *
 * The .ttf files are gitignored: binaries never enter the repo.
 *
 * Offline escape hatch: SKIP_FONT_PREFETCH=1. It restores the runtime Google
 * dependency this script exists to remove, so it is for a local offline build
 * only, never for a deploy.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const FONT_DIR = path.join("src", "lib", "design", "render", "fonts");

/* The one expression that resolves where faces are written. main() must not
   build its own path: the renderer reads an absolute directory, the guard pins
   this function's result, and a second `path.join` here would be a place the
   two could disagree while every test stayed green. */
export function vendorDirectory() {
  return path.join(process.cwd(), FONT_DIR);
}

/**
 * Mirrors SOURCES in src/lib/design/render/fonts.ts — same filenames, same
 * Google families. A plain .mjs run by node cannot import the TypeScript
 * module, so the list is duplicated; fetch-fonts.test.mjs pins the two copies
 * to each other so they cannot drift.
 */
export const FACES = [
  { file: "display-bold.ttf", family: "Bricolage Grotesque:wght@700" },
  { file: "body-regular.ttf", family: "Montserrat" },
  { file: "body-semibold.ttf", family: "Montserrat:wght@600" },
];

/**
 * Google serves WOFF2 to a modern browser and TTF to an ancient one, and
 * satori rejects WOFF2 with "Unsupported OpenType signature". This string is
 * the entire reason the request yields something usable.
 */
export const TTF_USER_AGENT =
  "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1";

export function ttfUrlFrom(css) {
  return (
    css.match(/src:\s*url\((.+?)\)\s*format\('(?:opentype|truetype)'\)/)?.[1] ??
    null
  );
}

/** TrueType, TrueType collection, or CFF OpenType — what satori can parse. */
const FONT_SIGNATURES = [
  [0x00, 0x01, 0x00, 0x00],
  [0x74, 0x72, 0x75, 0x65],
  [0x4f, 0x54, 0x54, 0x4f],
  [0x74, 0x74, 0x63, 0x66],
];

/* A real face is tens of kilobytes. The floor rejects an error page or a
   truncated body that happens to start with the right four bytes. */
const SMALLEST_PLAUSIBLE_FACE = 4096;

export function isUsableFace(bytes) {
  if (!bytes || bytes.length < SMALLEST_PLAUSIBLE_FACE) return false;
  return FONT_SIGNATURES.some((signature) =>
    signature.every((byte, index) => bytes[index] === byte),
  );
}

export async function downloadFace(family, fetchImpl = fetch) {
  const stylesheet = await fetchImpl(
    `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}`,
    { headers: { "User-Agent": TTF_USER_AGENT } },
  );
  if (!stylesheet.ok) {
    throw new Error(`stylesheet for ${family}: HTTP ${stylesheet.status}`);
  }

  const url = ttfUrlFrom(await stylesheet.text());
  if (!url) throw new Error(`no TrueType src offered for ${family}`);

  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!isUsableFace(bytes)) {
    throw new Error(`${url} is not a font satori can parse`);
  }
  return bytes;
}

/**
 * Records which family each vendored file was cut from. Lives in the ignored
 * font directory alongside the .ttf files.
 */
export const MANIFEST_FILE = "vendored.json";

/**
 * A file on disk is only current if it is a usable face AND it was cut from
 * the family FACES asks for now. Signature alone is not enough: change a
 * family here or in fonts.ts and every machine that already downloaded the old
 * one prints "cached" and renders the previous typeface forever, while a clean
 * CI build ships the new one — the two disagree and nothing says so.
 */
export function isCurrent(face, manifest, bytes) {
  return manifest[face.file] === face.family && isUsableFace(bytes);
}

const ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readManifest(directory) {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(directory, MANIFEST_FILE), "utf8"),
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

async function isVendored(target, face, manifest) {
  try {
    return isCurrent(face, manifest, await readFile(target));
  } catch {
    return false;
  }
}

async function vendorFace(face, directory, manifest, fetchImpl = fetch) {
  const target = path.join(directory, face.file);
  if (await isVendored(target, face, manifest)) return "cached";

  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const bytes = await downloadFace(face.family, fetchImpl);
      /* Written under a temp name and renamed, because a half-written file
         still satisfies the readFile in fonts.ts: the render would hand satori
         a truncated face rather than fall back. */
      const partial = `${target}.${process.pid}.part`;
      await writeFile(partial, bytes);
      await rename(partial, target);
      return "downloaded";
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) await delay(attempt * RETRY_DELAY_MS);
    }
  }
  throw new Error(`${face.file} — ${lastError?.message ?? lastError}`);
}

const C = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  dim: "\x1b[2m",
};

export async function main(fetchImpl = fetch) {
  if (process.env.SKIP_FONT_PREFETCH === "1") {
    console.log(
      `${C.dim}↷ Font prefetch skipped (SKIP_FONT_PREFETCH=1) — renders will fetch Google Fonts at runtime.${C.reset}`,
    );
    return;
  }

  const directory = vendorDirectory();
  await mkdir(directory, { recursive: true });

  const manifest = await readManifest(directory);
  const results = await Promise.allSettled(
    FACES.map((face) => vendorFace(face, directory, manifest, fetchImpl)),
  );

  const failures = [];
  const vendored = {};
  results.forEach((result, index) => {
    const { file, family } = FACES[index];
    if (result.status === "fulfilled") {
      vendored[file] = family;
      console.log(`${C.green}✓${C.reset} ${file} (${result.value})`);
    } else {
      console.log(`${C.red}✗${C.reset} ${result.reason.message}`);
      failures.push(file);
    }
  });

  /* Rebuilt from the successes rather than merged, so a face that failed keeps
     no entry and the next run re-downloads it instead of trusting the file. */
  await writeFile(
    path.join(directory, MANIFEST_FILE),
    `${JSON.stringify(vendored, null, 2)}\n`,
  );

  if (failures.length) {
    console.log(
      `\n${C.red}✗ Font prefetch FAILED — blocking build: ${failures.join(", ")}${C.reset}`,
    );
    console.log(
      `${C.dim}Shipping without these means every design render depends on fonts.googleapis.com being up.\nRe-run the build, or set SKIP_FONT_PREFETCH=1 to accept that dependency deliberately.${C.reset}`,
    );
    process.exit(1);
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  await main();
}
