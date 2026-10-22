// @vitest-environment node
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import { decodePngRgba } from "@/lib/images/png-pixels";
import {
  CAPITALS,
  IMAGE,
  LAYOUTS,
  LOGO,
  LOGO_ASPECT,
  LONG_WORDS,
  OVERSHOOT,
  PALETTE,
  PUNCTUATION,
  RATIOS,
  REALISTIC,
  SCRIPTS,
  specFor,
  WORST_CASE,
} from "./fixtures";
import { documentFromSpec } from "./from-spec";
import { createRendererMeasurer, type RendererMeasurer } from "./measure";
import { documentElement, EMOJI_FONT_FAMILY } from "./render";
import type { DesignDocument, DesignElement } from "./schema";
import {
  type Box,
  clipped,
  cropped,
  INK_TOLERANCE,
  inkBox,
  overflowOf,
  satoriInk,
  shifted,
} from "./testing-ink";
import { cacheOgAssets } from "./testing-og-assets";

/**
 * The editor and the export agree: every run of copy the builders produce
 * stays inside its box in Chromium as well as in satori.
 *
 * The same element tree is drawn by satori (the PNG) and by Chromium (the
 * PR 2 editor), with the same TTFs loaded through @font-face. Round 1 broke
 * here twice: text-wrap: balance broke lines in different places in the two
 * engines (B5, 17px past the box), and a box narrowed to satori's exact line
 * width wrapped an extra line in Chromium (B4, 87px). Both are pinned:
 * greedy wrapping in both engines, and every run measured with wrap slack.
 *
 * Glyphs the bundled faces lack come from fallback faces, and parity holds
 * only when both engines draw them in the same ones, which is what the
 * editor has to do too (spec, PR 2). satori draws CJK in the Noto
 * faces next/og fetches from Google Fonts, and emoji as Twemoji images 1em
 * wide. Chromium here gets the same Noto faces, registered under the
 * bundled family names so the machine's own faces never take part, and
 * Noto Color Emoji sized to a 1em advance under EMOJI_FONT_FAMILY, the
 * family every run lists after its own.
 *
 * Needs a Chromium. CI installs Playwright's (`playwright install
 * chromium`); locally the test also finds any Chromium Playwright has
 * downloaded before, or the one PLAYWRIGHT_CHROMIUM names.
 */

function chromiumPath(): string | null {
  const configured = process.env.PLAYWRIGHT_CHROMIUM;
  if (configured && existsSync(configured)) return configured;
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return bundled;
  const cache = join(homedir(), ".cache", "ms-playwright");
  if (!existsSync(cache)) return null;
  const installed = readdirSync(cache)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort()
    .reverse()
    .map((name) => join(cache, name, "chrome-linux64", "chrome"))
    .find((path) => existsSync(path));
  return installed ?? null;
}

cacheOgAssets();

const executable = chromiumPath();
if (!executable) {
  /* CI installs Chromium for this test, so a missing one there is a broken
     pipeline, not a reason to pass without checking. */
  if (process.env.CI) {
    throw new Error("browser-parity.smoke: CI has no Chromium installed");
  }
  console.warn(
    "browser-parity.smoke: no Chromium found; run `pnpm exec playwright install chromium`",
  );
}

let browser: Browser | null = null;
let fonts: Awaited<ReturnType<typeof loadBrandFonts>>;
let measurer: RendererMeasurer;
let fontFaces = "";

/* Realistic and worst-case copy with and without a photograph (a photo
   moves the copy in hero-center and the cards); the adversarial copy flat,
   since its geometry is what is under test. */
const CASES = [
  { name: "realistic", copy: REALISTIC, images: [null, IMAGE] },
  { name: "worst-case", copy: WORST_CASE, images: [null, IMAGE] },
  { name: "accented capitals", copy: OVERSHOOT, images: [null] },
  { name: "unbroken words", copy: LONG_WORDS, images: [null] },
  { name: "emoji", copy: SCRIPTS.emoji, images: [null] },
  { name: "emoji sequences", copy: SCRIPTS.emojiSequences, images: [null] },
  { name: "emoji symbols", copy: SCRIPTS.emojiSymbols, images: [null] },
  { name: "cjk", copy: SCRIPTS.cjk, images: [null] },
  { name: "vietnamese", copy: SCRIPTS.vietnamese, images: [null] },
  { name: "capitals", copy: CAPITALS, images: [null] },
  { name: "punctuation", copy: PUNCTUATION, images: [null] },
];

const CHROME_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/* Noto Color Emoji advances 1.245em; satori draws Twemoji 1em wide. */
const EMOJI_SIZE_ADJUST = "80.3%";

const CASE_TEXT = CASES.flatMap(({ copy }) => [
  copy.headline,
  copy.subheadline,
  copy.cta,
]).join("");

/** A Google Fonts face as a data URI, subset to the characters given. */
async function googleFace(family: string, text: string): Promise<string> {
  const css = await (
    await fetch(
      `https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`,
      { headers: { "User-Agent": CHROME_UA } },
    )
  ).text();
  const url = css.match(/src: url\((.+?)\) format\('woff2'\)/)?.[1];
  if (!url) throw new Error(`Google Fonts sent no ${family} face`);
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  return `data:font/woff2;base64,${bytes.toString("base64")}`;
}

function charactersOf(pattern: RegExp): string {
  const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
  return Array.from(
    new Set(
      Array.from(segmenter.segment(CASE_TEXT), ({ segment }) => segment).filter(
        (segment) => pattern.test(segment),
      ),
    ),
  ).join("");
}

/** Noto Sans JP, which serves CJK inside the brand family, and the emoji
 *  face, registered as its own family (render.tsx EMOJI_FONT_FAMILY). */
async function fallbackFaces(): Promise<{ cjk: string; emoji: string }> {
  const cjk = charactersOf(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303F\uFF00-\uFFEF]/u,
  );
  const emoji = charactersOf(
    /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3|\uFE0F/u,
  );
  return {
    cjk: await googleFace("Noto+Sans+JP", cjk),
    emoji: await googleFace("Noto+Color+Emoji", emoji),
  };
}

beforeAll(async () => {
  fonts = await loadBrandFonts(null);
  measurer = createRendererMeasurer({ fonts });
  const fallbacks = await fallbackFaces();
  const face = (font: (typeof fonts)[number], src: string, extra = "") =>
    `@font-face{font-family:"${font.name}";font-weight:${font.weight};font-style:${font.style ?? "normal"};src:url(${src});${extra}}`;
  /* A face with a unicode-range declared after the full face is tried first
     for the codepoints in its range; every other glyph keeps the bundled
     face. */
  fontFaces = [
    ...fonts.map((font) =>
      face(
        font,
        `data:font/ttf;base64,${Buffer.from(font.data as ArrayBuffer).toString("base64")}`,
      ),
    ),
    ...fonts.map((font) =>
      face(
        font,
        fallbacks.cjk,
        "unicode-range:U+3000-30FF,U+4E00-9FFF,U+FF00-FFEF;",
      ),
    ),
    `@font-face{font-family:"${EMOJI_FONT_FAMILY}";src:url(${fallbacks.emoji});size-adjust:${EMOJI_SIZE_ADJUST}}`,
  ].join("\n");
  if (executable)
    browser = await chromium.launch({ executablePath: executable });
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

async function chromiumInk(
  page: Page,
  doc: DesignDocument,
  element: DesignElement,
): Promise<Box | null> {
  const crop = cropped(doc, element);
  await page.setViewportSize({
    width: crop.doc.width,
    height: crop.doc.height,
  });
  const markup = renderToStaticMarkup(documentElement(crop.doc, {}));
  await page.setContent(
    `<!doctype html><html><head><style>${fontFaces} html,body{margin:0;padding:0;background:#fff}</style></head><body>${markup}</body></html>`,
  );
  await page.evaluate(() => document.fonts.ready);
  const shot = decodePngRgba(
    new Uint8Array(await page.screenshot({ type: "png" })),
  );
  if (!shot) throw new Error("screenshot did not decode");
  return shifted(clipped(inkBox(shot), shot), crop.dx, crop.dy);
}

describe.skipIf(!executable).each(LAYOUTS)(
  "%s in Chromium and satori",
  (layout) => {
    it.each(RATIOS)(
      "keeps every run of copy inside its box in both engines at %s",
      async (ratio) => {
        if (!browser) throw new Error("no browser");
        const page = await browser.newPage({ deviceScaleFactor: 1 });
        const overflows: string[] = [];
        /* Ink depends only on an element's own geometry and type, and most
           layouts place copy the same with and without a photo. */
        const seen = new Set<string>();
        try {
          for (const { name, copy, images } of CASES) {
            for (const image of images) {
              const { document: doc } = await documentFromSpec({
                spec: specFor(layout, ratio, copy),
                palette: PALETTE,
                canvas: canvasFor(ratio),
                image,
                logo: { asset: LOGO, aspect: LOGO_ASPECT },
                measurer,
              });
              for (const element of doc.elements) {
                if (element.type !== "text" && element.type !== "button") {
                  continue;
                }
                const key = JSON.stringify({
                  ...element,
                  color: null,
                  fill: null,
                });
                if (seen.has(key)) continue;
                seen.add(key);
                const label = `${name} image=${Boolean(image)} ${element.id}`;
                const inBrowser = await chromiumInk(page, doc, element);
                const inSatori = await satoriInk(doc, element, fonts);
                if (!inBrowser || !inSatori) {
                  overflows.push(`${label}: one engine drew nothing`);
                  continue;
                }
                const browserOver = overflowOf(inBrowser, element, doc);
                const satoriOver = overflowOf(inSatori, element, doc);
                if (browserOver > INK_TOLERANCE) {
                  overflows.push(`${label}: ${browserOver}px in Chromium`);
                }
                if (satoriOver > INK_TOLERANCE) {
                  overflows.push(`${label}: ${satoriOver}px in satori`);
                }
              }
            }
          }
        } finally {
          await page.close();
        }
        expect(overflows, `${layout} ${ratio}`).toEqual([]);
      },
      600_000,
    );
  },
);
