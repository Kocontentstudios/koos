import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getObjectBytes } from "@/lib/storage";

export interface LoadedFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 600 | 700;
  style: "normal";
}

interface FontSource {
  name: string;
  weight: 400 | 600 | 700;
  /** Vendored file, preferred: no network, no runtime dependency. */
  file: string;
  /** Google Fonts family used only if the vendored file is absent. */
  family: string;
}

const FONT_DIR = join(process.cwd(), "src/lib/design/render/fonts");

const SOURCES: FontSource[] = [
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
const brandFontCache = new Map<string, LoadedFont[] | null>();

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
async function loadUploadedFont(url: string): Promise<ArrayBuffer | null> {
  try {
    const base = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");
    // Read from our own bucket by key. The URL reaches here from a brand row,
    // but that row is user-writable, so it is not a fetch target.
    if (!base || !url.startsWith(base)) return null;
    const bytes = await getObjectBytes(url.slice(base.length + 1));
    const data = new Uint8Array(bytes);
    // The upload route checked this too; re-checked here because a row can
    // outlive the file it points at, and satori throws on a bad signature
    // rather than declining.
    if (!isRenderableFont(data)) return null;
    return data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
  } catch {
    return null;
  }
}

/** TrueType, TrueType collection, or CFF OpenType — what satori can parse. */
export function isRenderableFont(bytes: Uint8Array): boolean {
  const signatures = [
    [0x00, 0x01, 0x00, 0x00],
    [0x74, 0x72, 0x75, 0x65],
    [0x4f, 0x54, 0x54, 0x4f],
    [0x74, 0x74, 0x63, 0x66],
  ];
  return signatures.some((sig) => sig.every((b, i) => bytes[i] === b));
}

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
export async function loadBrandFonts(
  brandFontUrl?: string | null,
): Promise<LoadedFont[]> {
  const defaults = await loadDefaultFonts();
  if (!brandFontUrl) return defaults;

  if (!brandFontCache.has(brandFontUrl)) {
    const data = await loadUploadedFont(brandFontUrl);
    // Evict oldest-first rather than clearing: a busy process should not lose
    // every brand's font because one more arrived.
    if (brandFontCache.size >= MAX_BRAND_FONTS) {
      const oldest = brandFontCache.keys().next().value;
      if (oldest !== undefined) brandFontCache.delete(oldest);
    }
    brandFontCache.set(
      brandFontUrl,
      data
        ? [{ name: "Display", data, weight: 700, style: "normal" as const }]
        : null,
    );
  }

  const brandFonts = brandFontCache.get(brandFontUrl);
  if (!brandFonts) return defaults;
  return [...defaults.filter((f) => f.name !== "Display"), ...brandFonts];
}

/** Test seam: the caches live for the process, which would otherwise leak
 *  between cases. */
export function __resetFontCaches() {
  cache = null;
  brandFontCache.clear();
}
