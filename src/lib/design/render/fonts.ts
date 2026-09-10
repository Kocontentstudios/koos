import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  getObjectBytes,
  STORAGE_PREFIXES,
  storageKeyFrom,
} from "@/lib/storage";
import { checkFontBytes, isRenderableFont } from "./font-file";

export interface LoadedFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 600 | 700;
  style: "normal";
  /* Lets the renderer tell whether a failed render is worth retrying without
     the brand's face. Structure alone cannot decide it: a face can satisfy
     every table check and still defeat satori — an unsupported GSUB lookup, a
     variable-font axis table — so this flag is what separates "the typeface is
     unusable" from "the renderer is broken". */
  fromBrand?: boolean;
}

interface FontSource {
  name: string;
  weight: 400 | 600 | 700;
  /** Written into FONT_DIR by scripts/fetch-fonts.mjs at build time. Preferred:
   *  no network, no runtime dependency. */
  file: string;
  /** Google Fonts family, used only if the vendored file is absent — a deploy
   *  whose file tracing dropped it, or a dev server before a build has run. */
  family: string;
}

/** Exported so the prefetch script and the pipeline gate pin themselves to the
 *  directory this module actually reads, rather than to a copy of the string. */
export const FONT_DIR = join(process.cwd(), "src/lib/design/render/fonts");

/** Exported so scripts/fetch-fonts.mjs's list is pinned to this one by value
 *  rather than by a test re-reading this file as text. */
export const SOURCES: FontSource[] = [
  {
    name: "Display",
    weight: 700,
    file: "display-bold.ttf",
    family: "Bricolage Grotesque:wght@700",
  },
  { name: "Body", weight: 400, file: "body-regular.ttf", family: "Montserrat" },
  {
    name: "Body",
    weight: 600,
    file: "body-semibold.ttf",
    family: "Montserrat:wght@600",
  },
];

let cache: LoadedFont[] | null = null;

/* Keyed by font URL, because the cache is no longer one shared list: a brand
   with its own face must not serve it to every other brand rendering
   concurrently. Bounded so a workspace with many brands cannot grow it without
   limit — fonts are a few hundred KB each. */
const MAX_BRAND_FONTS = 20;
const brandFontCache = new Map<
  string,
  { faces: LoadedFont[] | null; reason: string | null }
>();

/** Pulls a single TTF out of a Google Fonts CSS response. Only used when the
 * vendored file is missing, so a mis-traced deploy degrades to a slower
 * render instead of a 500. */
async function fetchGoogleFont(family: string): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}`,
      {
        headers: {
          // An old UA is what makes Google serve TTF. A modern one returns
          // WOFF2, which satori rejects with "Unsupported OpenType signature".
          "User-Agent":
            "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1",
        },
      },
    ).then((r) => r.text());
    const url = css.match(
      /src:\s*url\((.+?)\)\s*format\('(?:opentype|truetype)'\)/,
    )?.[1];
    if (!url) return null;
    return await fetch(url).then((r) => r.arrayBuffer());
  } catch {
    return null;
  }
}

async function loadOne(source: FontSource): Promise<LoadedFont | null> {
  try {
    const buffer = await readFile(join(FONT_DIR, source.file));
    /* Structural, not just the signature: a vendored face truncated by a
       partial file-trace copy or a bad artifact restore satisfies readFile and
       then throws inside satori, which 500s the render instead of falling back
       to the network. */
    const check = checkFontBytes(buffer);
    if (!check.ok) throw new Error(`unusable vendored face: ${check.reason}`);
    return {
      name: source.name,
      data: buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer,
      weight: source.weight,
      style: "normal",
    };
  } catch {
    const data = await fetchGoogleFont(source.family);
    if (!data) return null;
    return { name: source.name, data, weight: source.weight, style: "normal" };
  }
}

/** Satori falls back silently to its bundled Geist 400 for any weight it was
 * not given, which quietly wrecks the typographic hierarchy — so every weight
 * the layouts use must be loaded explicitly. */
async function loadDefaultFonts(): Promise<LoadedFont[]> {
  if (cache) return cache;
  const loaded = (await Promise.all(SOURCES.map(loadOne))).filter(
    (f): f is LoadedFont => f !== null,
  );
  // Never cache an empty result: a transient fetch failure would otherwise
  // poison every later render for the lifetime of the process.
  if (loaded.length > 0) cache = loaded;
  return loaded;
}

/** Fetches an uploaded face. Null for anything satori could not parse, so the
 *  caller falls back rather than handing it bytes that throw mid-render. */
/** The face, or why it could not be used. A reason rather than a bare null:
 *  declining the bytes here is what stops a corrupt font reaching satori, and
 *  it is also the ONLY moment anything knows why — by the time the design has
 *  rendered in the bundled faces, the fault is invisible and the user is left
 *  wondering why their typeface never appears. */
type UploadedFont =
  | { data: ArrayBuffer; reason: null }
  | { data: null; reason: string };

async function loadUploadedFont(url: string): Promise<UploadedFont> {
  try {
    /* Pinned to the fonts prefix, not merely to our origin. brandFontUrl is a
       user-writable column, so without the prefix a brand could point it at
       another tenant's deliverables and have them read. */
    const key = storageKeyFrom(url, STORAGE_PREFIXES.fonts);
    if (!key) return { data: null, reason: "it is not stored with your brand" };
    const bytes = await getObjectBytes(key);
    const data = new Uint8Array(bytes);
    /* Re-checked here, and structurally, because the upload route's check does
       not cover the brands that already stored a bad file: a row outlives the
       file it points at, and every render for such a brand fails identically
       until something declines the bytes instead of handing them to satori. */
    const check = checkFontBytes(data);
    if (!check.ok) return { data: null, reason: check.reason };
    return {
      data: data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ) as ArrayBuffer,
      reason: null,
    };
  } catch {
    return { data: null, reason: "the file could not be read" };
  }
}

export { isRenderableFont };

/**
 * The fonts a render should use, with the brand's own face substituted for the
 * display family when it has uploaded one.
 *
 * Display only, deliberately. An upload is a single file at a single weight,
 * and the layouts need Body at 400 and 600 — swapping those for one face would
 * flatten the weight hierarchy that satori's silent-fallback comment above
 * exists to protect. Headlines are where a brand typeface actually reads.
 *
 * Any failure returns the built-in set: a bad or missing font file must cost
 * the typeface, never the design.
 */
export interface BrandFontUrls {
  /** Substituted for the Display family — headings. */
  heading?: string | null;
  /** Substituted for the Body family — body copy, buttons and CTAs. */
  body?: string | null;
}

/**
 * The faces a brand renders with: its own where it uploaded one, the bundled
 * defaults everywhere else.
 *
 * The two slots are independent. A brand that uploaded only a heading face
 * keeps the bundled Montserrat for body copy, and vice versa — which is also
 * every brand's state before FEAT-020, so nothing renders differently until
 * someone uploads a second font.
 *
 * Each face is cached under its own URL, so two brands sharing a face pay for
 * it once and a brand using one face for both roles loads it once.
 */
export async function loadBrandFonts(
  urls?: BrandFontUrls | string | null,
): Promise<LoadedFont[]> {
  const defaults = await loadDefaultFonts();
  /* A bare string is the pre-FEAT-020 signature: one URL, meaning the heading
     face. Kept so every existing caller and test keeps working, and so a
     single-font brand cannot be misread as having no fonts at all. */
  const { heading, body } =
    typeof urls === "string" || urls == null
      ? { heading: urls, body: null }
      : urls;

  if (!heading && !body) return defaults;

  const [headingFace, bodyFace] = await Promise.all([
    heading ? cachedFace(heading, "Display", 700) : null,
    body ? cachedFace(body, "Body", 400) : null,
  ]);

  /* Only the roles that were actually replaced drop their defaults. Removing
     both unconditionally would leave a brand with one uploaded face rendering
     its other role in nothing at all. */
  const replaced = new Set<string>();
  if (headingFace) replaced.add("Display");
  if (bodyFace) replaced.add("Body");

  return [
    ...defaults.filter((f) => !replaced.has(f.name)),
    ...(headingFace ?? []),
    ...(bodyFace ?? []),
  ];
}

/** One face, loaded once per URL. Returns null when the file is unusable, so
 *  the caller keeps its default rather than rendering with nothing. */
async function cachedFace(
  url: string,
  name: string,
  weight: LoadedFont["weight"],
): Promise<LoadedFont[] | null> {
  const key = `${name}:${url}`;
  if (!brandFontCache.has(key)) {
    const loaded = await loadUploadedFont(url);
    // Evict oldest-first rather than clearing: a busy process should not lose
    // every brand's font because one more arrived.
    if (brandFontCache.size >= MAX_BRAND_FONTS) {
      const oldest = brandFontCache.keys().next().value;
      if (oldest !== undefined) brandFontCache.delete(oldest);
    }
    brandFontCache.set(key, {
      faces: loaded.data
        ? [
            {
              name,
              data: loaded.data,
              weight,
              style: "normal" as const,
              fromBrand: true,
            },
          ]
        : null,
      reason: loaded.reason,
    });
  }
  return brandFontCache.get(key)?.faces ?? null;
}

/**
 * Why a brand's faces were not used, for the slots it actually filled.
 *
 * Read after loadBrandFonts, off the same cache, so it costs nothing and
 * cannot disagree with what was rendered. It exists because declining a
 * corrupt font is invisible by design: the render succeeds in the bundled
 * faces, so without this the user is never told, which is the silent fallback
 * KOS-V1-BUG-018 set out to remove.
 */
export function brandFontFaults(
  urls?: BrandFontUrls | string | null,
): string[] {
  const { heading, body } =
    typeof urls === "string" || urls == null
      ? { heading: urls, body: null }
      : urls;
  const faults: string[] = [];
  for (const [url, name] of [
    [heading, "Display"],
    [body, "Body"],
  ] as const) {
    if (!url) continue;
    const reason = brandFontCache.get(`${name}:${url}`)?.reason;
    if (reason) faults.push(reason);
  }
  return faults;
}

/** Test seam: the caches live for the process, which would otherwise leak
 *  between cases. */
export function __resetFontCaches() {
  cache = null;
  brandFontCache.clear();
}
