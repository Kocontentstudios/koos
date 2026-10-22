// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import { type LoadedFont, loadBrandFonts } from "@/lib/design/render/fonts";
import {
  closeRenderPool,
  RenderTimeoutError,
  renderPng,
} from "@/lib/design/render/satori-pool";
import { documentElement, minBreakableWidth } from "./render";
import type { DesignDocument, TextElement } from "./schema";
import { cacheOgAssets } from "./testing-og-assets";
import { normalizeText, textFault } from "./text-safety";

/**
 * No text the schema accepts can loop satori.
 *
 * Satori loops when a word-breaking line is narrower than one grapheme
 * cluster. Round 3 bounded clusters by marks and code points and two
 * shapes it had not imagined still looped (six conjoining jamo, a letter
 * with five tag characters). So this does not list shapes: it generates
 * clusters from every kind of code point a cluster can be built from,
 * keeps what the schema keeps (normalizeText, textFault), and draws each
 * accepted cluster alone in a box exactly as narrow as the renderer still
 * breaks words in (minBreakableWidth), at the loosest and tightest tracking.
 * Any loop is a timeout. The listed clusters are the widest known ones.
 *
 * FUZZ_CLUSTERS and FUZZ_SEED widen the run beyond the gate's sample
 * (`FUZZ_CLUSTERS=20000 pnpm vitest run cluster-fuzz`).
 */

cacheOgAssets();

const SEED = Number(process.env.FUZZ_SEED ?? 33);
const CLUSTERS = Number(process.env.FUZZ_CLUSTERS ?? 400);
const PER_DOCUMENT = 60;
const LIMIT_MS = 8_000;
const FONT_SIZE = 100;
const TRACKINGS = [-0.5, 0, 2];

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const range = (from: number, to: number) => ({ from, to });

/* Bases: letters of every supported script, the widest Common glyphs, and
   pictographs. Extenders: everything Unicode lets follow a base inside one
   cluster (marks, selectors, joiners, tags, jamo, skin tones, regional
   indicators, the keycap). */
const BASES = [
  range(0x41, 0x7a),
  range(0xc0, 0x24f),
  range(0x1e00, 0x1eff),
  range(0x370, 0x3ff),
  range(0x1f00, 0x1fff),
  range(0x400, 0x4ff),
  range(0x530, 0x58f),
  range(0x10a0, 0x10ff),
  range(0x4e00, 0x9fff),
  range(0x3040, 0x30ff),
  range(0xac00, 0xd7a3),
  range(0x1100, 0x11ff),
  range(0x3100, 0x312f),
  range(0x2000, 0x2bff),
  range(0x2e00, 0x2e7f),
  range(0x3000, 0x303f),
  range(0xff00, 0xffef),
  range(0x1f300, 0x1faff),
  range(0x30, 0x39),
  range(0x23, 0x23),
  range(0x2a, 0x2a),
];
const EXTENDERS = [
  range(0x300, 0x36f),
  range(0x1ab0, 0x1aff),
  range(0x1dc0, 0x1dff),
  range(0x20d0, 0x20ff),
  range(0xfe00, 0xfe0f),
  range(0xfe20, 0xfe2f),
  range(0xe0100, 0xe01ef),
  range(0x200d, 0x200d),
  range(0x200c, 0x200c),
  range(0xe0020, 0xe007f),
  range(0x1100, 0x11ff),
  range(0xa960, 0xa97f),
  range(0xd7b0, 0xd7ff),
  range(0x1f3fb, 0x1f3ff),
  range(0x1f1e6, 0x1f1ff),
  range(0x20e3, 0x20e3),
  range(0x1f300, 0x1faff),
];

function pick(next: () => number, ranges: { from: number; to: number }[]) {
  const { from, to } = ranges[Math.floor(next() * ranges.length)];
  return String.fromCodePoint(from + Math.floor(next() * (to - from + 1)));
}

const PICTOGRAPHS = [range(0x1f300, 0x1faff), range(0x2600, 0x27bf)];
const MODIFIERS = [
  range(0xfe0f, 0xfe0f),
  range(0x1f3fb, 0x1f3ff),
  range(0x20e3, 0x20e3),
];

/** A base and up to ten extenders of any kind. */
function soup(next: () => number): string {
  let cluster = pick(next, BASES);
  const extenders = Math.floor(next() * 11);
  for (let i = 0; i < extenders; i += 1) cluster += pick(next, EXTENDERS);
  return cluster;
}

/** One to six pictographs joined by ZWJ, each with a selector, skin tone or
 *  keycap now and then: real sequences, over-long ones and broken ones. */
function sequence(next: () => number): string {
  const parts = 1 + Math.floor(next() * 6);
  return Array.from({ length: parts }, () => {
    let element = pick(next, PICTOGRAPHS);
    if (next() < 0.5) element += pick(next, MODIFIERS);
    return element;
  }).join("\u200D");
}

/** Regional indicators, keycaps and tag runs, the other ways several code
 *  points make one picture. */
function flag(next: () => number): string {
  const roll = next();
  if (roll < 0.4) {
    return Array.from({ length: 1 + Math.floor(next() * 4) }, () =>
      pick(next, [range(0x1f1e6, 0x1f1ff)]),
    ).join("");
  }
  if (roll < 0.7) {
    return `${pick(next, [range(0x30, 0x39), range(0x23, 0x23), range(0x2a, 0x2a)])}${next() < 0.5 ? "\uFE0F" : ""}\u20E3${next() < 0.3 ? "\u20E3" : ""}`;
  }
  const tags = Array.from({ length: Math.floor(next() * 8) }, () =>
    pick(next, [range(0xe0061, 0xe007a)]),
  ).join("");
  return `${next() < 0.7 ? "🏴" : pick(next, BASES)}${tags}${next() < 0.7 ? "\u{E007F}" : ""}`;
}

/** Raw candidate clusters, a third of each kind. */
function candidates(seed: number, count: number): string[] {
  const next = random(seed);
  const makers = [soup, sequence, flag];
  return Array.from({ length: count }, (_, i) => makers[i % 3](next));
}

/** The widest units known: ⸻ is 2.84em in Noto Sans, the rest are every
 *  multi-code-point shape the schema keeps. */
const KNOWN_WIDE = [
  "⸻",
  "⸺",
  "‱",
  "⨌",
  "⟿",
  "₧",
  "繼",
  "ᄀ",
  "1️⃣",
  "#⃣",
  "©️",
  "❤️",
  "👍🏾",
  "🇳🇬",
  "👨‍👩‍👧‍👦",
  "👩🏽‍❤️‍💋‍👨🏿",
  "🧑🏾‍🦯‍➡️",
  "🏳️‍⚧️",
  "🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}",
];

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Every distinct cluster the schema would store from `raw`, or none when
 *  it refuses the copy. */
function accepted(raw: string[]): { kept: string[]; refused: number } {
  const kept = new Set<string>();
  let refused = 0;
  for (const text of raw) {
    const normal = normalizeText(text);
    if (normal.length === 0) continue;
    if (textFault(normal)) {
      refused += 1;
      continue;
    }
    for (const { segment } of segmenter.segment(normal)) kept.add(segment);
  }
  return { kept: [...kept], refused };
}

const CANVAS = canvasFor("9:16");

function textElement(
  id: string,
  text: string,
  letterSpacing: number,
  y: number,
): TextElement {
  const look = { fontSize: FONT_SIZE, letterSpacing };
  return {
    id,
    name: id,
    type: "text",
    x: 0,
    y,
    width: minBreakableWidth(look, text),
    height: FONT_SIZE * 2,
    rotation: 0,
    opacity: 1,
    hidden: false,
    locked: false,
    text,
    role: "body",
    font: "heading",
    fontSize: FONT_SIZE,
    fontWeight: 700,
    lineHeight: 1.1,
    letterSpacing,
    align: "left",
    italic: false,
    color: "#000000",
  };
}

/* Not validated: the document deliberately holds more runs than a design
   may, so one render checks many clusters. */
function documentOf(clusters: string[], letterSpacing: number): DesignDocument {
  return {
    version: 1,
    ...CANVAS,
    background: "#FFFFFF",
    elements: clusters.map((cluster, i) =>
      textElement(`c${i}`, cluster, letterSpacing, (i % 9) * FONT_SIZE * 2),
    ),
  };
}

let fonts: LoadedFont[];
beforeAll(async () => {
  fonts = await loadBrandFonts(null);
});
afterAll(closeRenderPool);

/** Clusters that looped, found by halving any batch that timed out. */
async function looping(
  clusters: string[],
  letterSpacing: number,
): Promise<string[]> {
  try {
    await renderPng(
      documentElement(documentOf(clusters, letterSpacing), {}),
      CANVAS,
      fonts,
      {
        limitMs: LIMIT_MS,
      },
    );
    return [];
  } catch (error) {
    if (!(error instanceof RenderTimeoutError)) throw error;
    if (clusters.length === 1) return clusters;
    const half = Math.ceil(clusters.length / 2);
    return [
      ...(await looping(clusters.slice(0, half), letterSpacing)),
      ...(await looping(clusters.slice(half), letterSpacing)),
    ];
  }
}

async function loopsIn(clusters: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const letterSpacing of TRACKINGS) {
    const batches: string[][] = [];
    for (let i = 0; i < clusters.length; i += PER_DOCUMENT) {
      batches.push(clusters.slice(i, i + PER_DOCUMENT));
    }
    for (const batch of batches) {
      for (const cluster of await looping(batch, letterSpacing)) {
        found.push(`${JSON.stringify(cluster)} at tracking ${letterSpacing}`);
      }
    }
  }
  return found;
}

describe("clusters the schema accepts", () => {
  it("keeps the known widest clusters", () => {
    expect(accepted(KNOWN_WIDE).kept.sort()).toEqual([...KNOWN_WIDE].sort());
  });

  it("never loop satori at the narrowest width words still break in", async () => {
    const { kept, refused } = accepted(candidates(SEED, CLUSTERS));
    const multi = kept.filter((cluster) => Array.from(cluster).length > 1);
    /* The generator has to reach the shapes that matter, or this passes by
       testing single letters. */
    expect(refused).toBeGreaterThan(CLUSTERS / 10);
    expect(multi.length).toBeGreaterThan(10);
    expect(await loopsIn([...KNOWN_WIDE, ...kept])).toEqual([]);
  }, 600_000);

  /* The two round-3 loops, past the schema: drawn as satori received them,
     each is wider than the line; normalised, neither is. */
  it("turns the round-3 loops into text that draws", async () => {
    const jamo = "ᄀ".repeat(6);
    const tagged = `a${"\u{E0061}".repeat(5)}`;
    expect(textFault(normalizeText(jamo))?.code).toBe(
      "TEXT_CLUSTER_TOO_COMPLEX",
    );
    expect(normalizeText(tagged)).toBe("a");
    expect(await loopsIn([normalizeText(tagged)])).toEqual([]);
  }, 120_000);
});
