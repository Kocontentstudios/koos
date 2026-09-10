// @vitest-environment node
/**
 * Pins the three ends of the font-vendoring pipeline to each other.
 *
 * KOS-V1-BUG-010 was not a wrong value anywhere — every file was internally
 * consistent. `fonts.ts` read a directory, and nothing wrote it. The failure is
 * invisible by construction: the build succeeds, the renders succeed, and the
 * only symptom is that production quietly depends on fonts.googleapis.com.
 *
 * So the contract is: the directory the renderer READS, the directory the
 * prefetch WRITES, and the glob Next FORCE-INCLUDES into the deployed function
 * must be one directory — and every route that renders must be force-included.
 *
 * Both ends are IMPORTED, never parsed. A guard that reads source text can be
 * shadowed by a comment that merely mentions the option, and then it grades a
 * decoy while the real config rots.
 */
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config.ts";
import { buildFont } from "../src/lib/design/render/font-fixtures.ts";
import { FONT_DIR as RUNTIME_FONT_DIR } from "../src/lib/design/render/fonts.ts";
import {
  FACES,
  main,
  TTF_USER_AGENT,
  FONT_DIR as VENDOR_FONT_DIR,
} from "./fetch-fonts.mjs";

/* Serves the CSS shape downloadFace parses, then a real renderable face, so
   main() runs its whole write path without leaving the machine. */
function stubbedGoogleFonts() {
  return async (url) =>
    String(url).includes("css2")
      ? {
          ok: true,
          text: async () =>
            `src: url(https://fonts.gstatic.com/x.ttf) format('truetype');`,
          headers: { get: () => TTF_USER_AGENT },
        }
      : {
          ok: true,
          /* Padded past the prefetch's 4096-byte floor, which exists to
             reject an error page wearing a font signature. Trailing bytes sit
             after every table, so the file stays structurally valid. */
          arrayBuffer: async () => {
            const font = buildFont();
            const padded = new Uint8Array(8192);
            padded.set(font, 0);
            return padded.buffer;
          },
        };
}

const REPO = process.cwd();
const APP_DIR = path.join(REPO, "src/app");
const RENDERER = path.join(REPO, "src/lib/design/render/fonts.ts");
const GUARD = path.join(REPO, "scripts/font-pipeline.test.mjs");

const read = (file) => readFile(file, "utf8");

async function isFile(candidate) {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

/** Every distinct directory a set of tracing includes force-includes. */
function forceIncludedDirs(includes) {
  return [
    ...new Set(
      Object.values(includes)
        .flat()
        .map((glob) => path.resolve(REPO, path.dirname(glob))),
    ),
  ];
}

const tracedRoutes = (includes) => Object.keys(includes).sort();

const IMPORT_PATTERNS = [
  /from\s+"([^"]+)"/g,
  /import\(\s*"([^"]+)"\s*\)/g,
  /^\s*import\s+"([^"]+)"/gm,
];

async function resolveSpecifier(specifier, importer) {
  if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return null;
  const base = specifier.startsWith("@/")
    ? path.join(REPO, "src", specifier.slice(2))
    : path.resolve(path.dirname(importer), specifier);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

const importsCache = new Map();

async function importsOf(file) {
  if (importsCache.has(file)) return importsCache.get(file);
  const source = await read(file);
  const specifiers = new Set(
    IMPORT_PATTERNS.flatMap((pattern) => [...source.matchAll(pattern)]).map(
      ([, specifier]) => specifier,
    ),
  );
  const resolved = (
    await Promise.all(
      [...specifiers].map((specifier) => resolveSpecifier(specifier, file)),
    )
  ).filter(Boolean);
  importsCache.set(file, resolved);
  return resolved;
}

const reachesCache = new Map();

async function reachesRenderer(file) {
  if (file === RENDERER) return true;
  if (reachesCache.has(file)) return reachesCache.get(file) === true;
  // A cycle answers false on this branch; a true answer still arrives by any
  // other path into the renderer.
  reachesCache.set(file, "pending");
  let reached = false;
  for (const imported of await importsOf(file)) {
    if (await reachesRenderer(imported)) {
      reached = true;
      break;
    }
  }
  reachesCache.set(file, reached);
  return reached;
}

async function appEntries(directory = APP_DIR) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await appEntries(full)));
    else if (/^(route|page)\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** The route path Next derives from an app-directory file — normalizeAppPath:
 *  the /route or /page suffix and any (group) segment fall away. */
function routePathOf(entryFile) {
  const segments = path
    .relative(APP_DIR, entryFile)
    .split(path.sep)
    .slice(0, -1)
    .filter((segment) => !/^\(.*\)$/.test(segment));
  return `/${segments.join("/")}`;
}

async function renderingRoutes() {
  const rendering = [];
  for (const entry of await appEntries()) {
    if (await reachesRenderer(entry)) rendering.push(routePathOf(entry));
  }
  return rendering.sort();
}

const includes = nextConfig.outputFileTracingIncludes ?? {};

/* Two known gaps, left open deliberately because closing them costs more than
   the drift they permit, and neither is reachable in this repo today:

   - reachesRenderer memoises the provisional `false` it returns on an import
     cycle, so a value-level cycle could hide a rendering route from the route
     set below. No such cycle exists here.
   - routePathOf mirrors Next's normalizeAppPath for route groups and dynamic
     segments but not for @slot parallel segments, where it would demand a key
     Next never matches. No parallel routes render designs. */
describe("the vendored font directory", () => {
  it("is one directory across the renderer, the prefetch and the deploy", () => {
    expect(path.resolve(REPO, VENDOR_FONT_DIR)).toBe(RUNTIME_FONT_DIR);
    expect(forceIncludedDirs(includes)).toEqual([RUNTIME_FONT_DIR]);
  });

  /* The constant is not the guarantee: the prefetch can export the right path
     and still write somewhere else, and no amount of reading its source proves
     otherwise. So this RUNS it, against a stubbed transport and a throwaway
     cwd, and looks at where the bytes land. A prefetch that vendors into a
     directory the renderer never reads is the original defect restored. */
  it("is where the prefetch actually writes, not merely what it exports", async () => {
    const sandbox = await mkdtemp(path.join(tmpdir(), "font-pipeline-"));
    const cwd = process.cwd();
    try {
      process.chdir(sandbox);
      await main(stubbedGoogleFonts());
      const written = await readdir(path.join(sandbox, VENDOR_FONT_DIR));
      expect(written.filter((f) => f.endsWith(".ttf")).sort()).toEqual(
        FACES.map((f) => f.file).sort(),
      );
    } finally {
      process.chdir(cwd);
      await rm(sandbox, { recursive: true, force: true });
    }
  });

  it("is force-included as font files, not as some other extension", () => {
    const globs = Object.values(includes).flat();
    expect(globs.length).toBeGreaterThan(0);
    for (const glob of globs) expect(path.basename(glob)).toBe("*.ttf");
  });
});

/* Every guard above is inert if the prefetch never runs. That is one `&&` in
   the most merge-conflict-prone object in the repo, and deleting it leaves the
   whole suite green while production goes back to fetching Google Fonts on
   every cold start — the defect this pipeline exists to remove. */
describe("the build actually runs the prefetch", () => {
  it("vendors the faces before next build", async () => {
    const pkg = JSON.parse(
      await readFile(path.join(REPO, "package.json"), "utf8"),
    );
    const build = pkg.scripts.build;
    expect(build).toContain("scripts/fetch-fonts.mjs");
    expect(build.indexOf("scripts/fetch-fonts.mjs")).toBeLessThan(
      build.indexOf("next build"),
    );
  });

  /* Chained with && so a failed prefetch stops the build. A `;` or a `||`
     would let a build that could not vendor the faces ship anyway. */
  it("lets a failed prefetch block the build", async () => {
    const pkg = JSON.parse(
      await readFile(path.join(REPO, "package.json"), "utf8"),
    );
    const between = pkg.scripts.build.slice(
      pkg.scripts.build.indexOf("scripts/fetch-fonts.mjs"),
      pkg.scripts.build.indexOf("next build"),
    );
    expect(between).toContain("&&");
    expect(between).not.toMatch(/[;|]\s*$/);
  });
});

describe("the deploy force-includes every route that renders", () => {
  it("traces the fonts into exactly the routes that load them", async () => {
    /* Both directions matter. A key naming a route that does not render means
       the fonts ship nowhere useful; a rendering route with no key means that
       function falls back to Google, which is the original defect. */
    expect(tracedRoutes(includes)).toEqual(await renderingRoutes());
  });

  /* The two assertions above must be satisfiable together. Requiring a key per
     rendering route while requiring exactly one force-included entry would make
     the only correct fix for a second renderer fail the guard, and a guard you
     have to edit to ship a correct change gets deleted instead. */
  it("stays satisfiable when a second route renders", () => {
    const glob = `./${VENDOR_FONT_DIR}/*.ttf`;
    const twoRoutes = {
      "/api/design/generate": [glob],
      "/api/design/preview": [glob],
    };

    expect(forceIncludedDirs(twoRoutes)).toEqual([RUNTIME_FONT_DIR]);
    expect(tracedRoutes(twoRoutes)).toEqual([
      "/api/design/generate",
      "/api/design/preview",
    ]);
  });

  it("reaches the renderer through loadBrandFonts", async () => {
    expect(await read(RENDERER)).toContain(
      "export async function loadBrandFonts",
    );
  });
});

/* The vacuity this file is most exposed to: a guard that reads next.config.ts
   as TEXT grades whatever the first textual match points at, so a comment above
   the real option shadows it and three simultaneous defects pass green. The
   values above are imported and evaluated; this keeps them that way. */
describe("the guard reads evaluated values, not source text", () => {
  it("never parses next.config.ts as text", async () => {
    const source = await read(GUARD);
    expect(source).toContain('from "../next.config.ts"');
    expect(source).not.toMatch(/read\w*\([^)]*next\.config/);
  });

  it("never parses the renderer's FONT_DIR out of its source", async () => {
    const source = await read(GUARD);
    expect(source).toContain('from "../src/lib/design/render/fonts.ts"');
    expect(source).not.toMatch(/FONT_DIR\\s\*=/);
  });
});
