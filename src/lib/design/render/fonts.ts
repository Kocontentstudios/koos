import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
export async function loadBrandFonts(): Promise<LoadedFont[]> {
  if (cache) return cache;
  const loaded = (await Promise.all(SOURCES.map(loadOne))).filter(
    (f): f is LoadedFont => f !== null,
  );
  // Never cache an empty result: a transient fetch failure would otherwise
  // poison every later render for the lifetime of the process.
  if (loaded.length > 0) cache = loaded;
  return loaded;
}
