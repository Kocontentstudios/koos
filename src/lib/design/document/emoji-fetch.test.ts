// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { type DesignDocument, designDocumentSchema } from "./schema";
import { MAX_EMOJI_PER_DOCUMENT, normalizeText } from "./text-safety";

/**
 * The per-design emoji cap measured against what next/og actually fetches.
 *
 * Three rounds of hand-written emoji spellings each left a new set of
 * miscounts green (tones stripped inside a joined sequence, gender signs,
 * hair components, couples, the selector kept inside a joined sequence),
 * each worth 4-8 s on a cold render. This test does not list spellings: it
 * builds documents at random from every kind of code point an emoji can be
 * made of, works out the pictures next/og would fetch for each the way
 * next/og does, and holds that no document the schema accepts makes it
 * fetch more than the cap.
 */

const OG_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve(
    "next/dist/compiled/@vercel/og/index.node.js",
  ),
  "utf8",
);

/* next/og's own key for a picture (index.node.js, getIconCode): the selector
   is dropped only when the cluster has no joiner. */
function iconCode(cluster: string): string {
  const keyed = cluster.includes("‍") ? cluster : cluster.replace(/️/g, "");
  return Array.from(keyed, (point) =>
    (point.codePointAt(0) ?? 0).toString(16),
  ).join("-");
}

/* Wider than satori's emoji test on purpose: a word it calls emoji is one
   this calls emoji too, so the count below can only be too high. */
const EMOJI_WORD =
  /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u{20E3}]/u;

const words = new Intl.Segmenter("en", { granularity: "word" });
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** The pictures next/og fetches for a design's copy: every word with an
 *  emoji in it, joined in order across the whole design, split into
 *  graphemes, keyed (satori's ad() and next/og's loadDynamicAsset). */
function ogFetches(copy: string[]): Set<string> {
  const emojiWords = copy.flatMap((text) =>
    Array.from(words.segment(text), ({ segment }) => segment).filter((word) =>
      EMOJI_WORD.test(word),
    ),
  );
  return new Set(
    Array.from(graphemes.segment(emojiWords.join("")), ({ segment }) =>
      iconCode(segment),
    ),
  );
}

describe("the model of next/og this test relies on", () => {
  it("still matches the bundled renderer", () => {
    /* If an upgrade changes any of these, ogFetches no longer describes
       what is fetched and this test must be updated with it. */
    expect(OG_SOURCE).toContain(
      'toCodePoint(char.indexOf(U200D) < 0 ? char.replace(UFE0Fg, "") : char)',
    );
    expect(OG_SOURCE).toContain('granularity: "word"');
    expect(OG_SOURCE).toContain(
      'r === "emoji" ? e[r].push(...gu(JA(t[r], "grapheme")))',
    );
  });
});

/* Small, fast, seeded: the same documents on every run. */
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

function pointsWith(property: RegExp, from: number, to: number): string[] {
  const out: string[] = [];
  for (let point = from; point <= to; point += 1) {
    const char = String.fromCodePoint(point);
    if (property.test(char)) out.push(char);
  }
  return out;
}

const PICTOGRAPHS = [
  ...pointsWith(/\p{Extended_Pictographic}/u, 0xa9, 0x3299),
  ...pointsWith(/\p{Extended_Pictographic}/u, 0x1f000, 0x1faff),
];
const MODIFIER_BASES = pointsWith(/\p{Emoji_Modifier_Base}/u, 0x261d, 0x1faff);
const TONES = pointsWith(/\p{Emoji_Modifier}/u, 0x1f3fb, 0x1f3ff);
const REGIONAL = pointsWith(/\p{Regional_Indicator}/u, 0x1f1e6, 0x1f1ff);
const HAIR = ["\u{1F9B0}", "\u{1F9B1}", "\u{1F9B2}", "\u{1F9B3}"];
const GENDER = ["♀", "♂"];
const PEOPLE = [
  "\u{1F468}",
  "\u{1F469}",
  "\u{1F9D1}",
  "\u{1F466}",
  "\u{1F467}",
];

/** One emoji-ish cluster, or a deliberately broken fragment: lone tones,
 *  lone regional indicators and stray selectors are what could merge with
 *  their neighbours once next/og joins the emoji words together. */
function cluster(next: () => number, kind?: number): string {
  const pick = <T>(items: T[]) => items[Math.floor(next() * items.length)];
  const vs = () => (next() < 0.5 ? "️" : "");
  const person = () => pick(PEOPLE) + (next() < 0.5 ? pick(TONES) : "");
  switch (kind ?? Math.floor(next() * 10)) {
    case 0:
      return pick(PICTOGRAPHS) + vs();
    case 1:
      return pick(MODIFIER_BASES) + pick(TONES);
    case 2:
      return `${person()}‍${pick(PICTOGRAPHS)}${vs()}`;
    case 3:
      return `${person()}‍${pick(GENDER)}${vs()}`;
    case 4:
      return `${person()}‍${pick(HAIR)}`;
    case 5:
      return `${person()}‍❤️‍${person()}`;
    case 6:
      return pick(REGIONAL) + (next() < 0.7 ? pick(REGIONAL) : "");
    case 7:
      return `${pick("0123456789#*".split(""))}️⃣`;
    case 8:
      return pick(TONES);
    default:
      return [person(), person(), person()].join("‍");
  }
}

function designOf(copy: string[]): DesignDocument {
  return {
    version: 1,
    width: 1080,
    height: 1350,
    background: "#FFFFFF",
    elements: copy.map((text, i) => ({
      id: `t${i}`,
      name: `t${i}`,
      x: 0,
      y: i * 100,
      width: 1080,
      height: 100,
      rotation: 0,
      opacity: 1,
      hidden: false,
      locked: false,
      type: "text" as const,
      text,
      role: "body" as const,
      font: "body" as const,
      fontSize: 32,
      fontWeight: 400 as const,
      lineHeight: 1.2,
      letterSpacing: 0,
      align: "left" as const,
      italic: false,
      color: "#000000",
    })),
  };
}

const TEXT_RANGE = PICTOGRAPHS.filter(
  (char) => (char.codePointAt(0) ?? 0) < 0x3300,
);

/** Every spelling of a cluster that differs only in VS16: none after any
 *  pictograph, and one after each. next/og keys them apart inside a joined
 *  sequence and alike outside one. */
function spellings(text: string): string[] {
  const bare = text.replace(/\uFE0F/g, "");
  const presented = Array.from(bare, (char) =>
    /\p{Extended_Pictographic}/u.test(char) ? `${char}\uFE0F` : char,
  ).join("");
  return [...new Set([text, bare, presented])];
}

/** The clusters of one generated design. Most designs mix every kind; the
 *  rest concentrate on one kind, on the text-default pictographs, or on
 *  every spelling of a few clusters, where a miscount of that one shape
 *  is what decides whether the design passes. */
function designClusters(next: () => number): string[] {
  const count = 4 + Math.floor(next() * 28);
  switch (Math.floor(next() * 4)) {
    case 0:
      return Array.from({ length: count }, () => cluster(next));
    case 1: {
      const kind = Math.floor(next() * 10);
      return Array.from({ length: count }, () => cluster(next, kind));
    }
    case 2:
      return Array.from(
        { length: count },
        () =>
          TEXT_RANGE[Math.floor(next() * TEXT_RANGE.length)] +
          (next() < 0.5 ? "\uFE0F" : ""),
      );
    default:
      return Array.from({ length: Math.ceil(count / 2) }, () =>
        cluster(next),
      ).flatMap(spellings);
  }
}

describe("no accepted design makes next/og fetch more than the cap", () => {
  it("holds over generated designs near and past the cap", () => {
    const next = random(33);
    let accepted = 0;
    let refused = 0;
    const over: string[] = [];
    for (let design = 0; design < 4000; design += 1) {
      const clusters = designClusters(next);
      const runs = 1 + Math.floor(next() * 3);
      const perRun = Math.ceil(clusters.length / runs);
      const copy = Array.from({ length: runs }, (_, run) =>
        clusters
          .slice(run * perRun, (run + 1) * perRun)
          .join(next() < 0.5 ? " " : ""),
      ).filter((text) => text.length > 0);
      const parsed = designDocumentSchema.safeParse(designOf(copy));
      if (!parsed.success) {
        refused += 1;
        continue;
      }
      accepted += 1;
      const drawn = parsed.data.elements.map((element) =>
        element.type === "text" ? element.text : "",
      );
      const fetches = ogFetches(drawn);
      if (fetches.size > MAX_EMOJI_PER_DOCUMENT) {
        over.push(`${fetches.size}: ${JSON.stringify(drawn)}`);
      }
    }
    /* Both sides of the cap have to be reached, or this proves nothing. */
    expect(accepted).toBeGreaterThan(500);
    expect(refused).toBeGreaterThan(500);
    expect(over.slice(0, 5)).toEqual([]);
  });

  it("counts what is stored, which is what is drawn", () => {
    for (const text of ["👩🏽‍💻 ok", "🇳🇬", "1️⃣"]) {
      expect(normalizeText(text)).toBe(normalizeText(normalizeText(text)));
    }
  });
});
