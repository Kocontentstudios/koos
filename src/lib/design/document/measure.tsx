import type { ReactElement } from "react";
import type { LoadedFont } from "@/lib/design/render/fonts";
import { renderPng } from "@/lib/design/render/satori-pool";
import { decodePngRgba } from "@/lib/images/png-pixels";
import {
  type InkExtent,
  lineBox,
  type TextLook,
  type TextMeasurer,
  unbreakableRuns,
} from "./fit";
import { breakableText } from "./line-breaks";
import { textRunStyle } from "./render";

/**
 * A TextMeasurer that asks satori.
 *
 * next/og does not expose satori's layout, only the finished PNG, so each
 * probe lays the run out next to a 4px red marker and reads where the marker
 * landed. The marker's offset IS the run's laid-out height (or width): yoga
 * placed it, in whole pixels, from the same style object documentElement
 * draws with.
 *
 * The canvas is only as large as the axis being read, never the run itself:
 * a height probe is 8px wide and a width probe is 4px tall. Satori still lays
 * out the full run, but resvg only rasterises a sliver, which is where the
 * time goes. A full-size probe of a headline costs about 300ms; these cost a
 * few milliseconds, which is what makes a binary search per text element
 * affordable inside a generation job.
 */

const MARKER = 4;
/** Taller than any canvas the app renders, so a run that cannot fit reads as
 *  "too tall" rather than being cut short and mistaken for fitting. */
const MAX_PROBE = 8000;
/** A probe is a few milliseconds of work. One that runs for seconds is a
 *  run satori cannot lay out, and waiting the full render limit for it would
 *  only delay the fault. */
const PROBE_LIMIT_MS = 10_000;

/** A probe canvas wider than this costs more to rasterise than it tells. */
const MAX_INK_PROBE_WIDTH = 6000;

/** Any pixel visibly off white is ink: an antialiased mark tip is faint, and
 *  emoji are colour pictures, not black glyphs. */
function isInk(pixels: Uint8Array, at: number): boolean {
  return Math.min(pixels[at], pixels[at + 1], pixels[at + 2]) < 235;
}

let graphemes: Intl.Segmenter | null = null;

/** The distinct graphemes of `text`, in groups short enough to set on one
 *  line of a probe. Vertical reach depends only on which glyphs occur, so
 *  each glyph is drawn once, as a word of its own: next/og picks fallback
 *  faces word by word, and an unspaced group of double-stacked capitals
 *  (Ẩ, Ể) drew in another face than the copy's words did, 5px shorter, so
 *  the headline spilled past its box. */
function glyphGroups(text: string, look: TextLook): string[] {
  graphemes ??= new Intl.Segmenter("en", { granularity: "grapheme" });
  const unique = Array.from(
    new Set(
      Array.from(graphemes.segment(text), ({ segment }) => segment).filter(
        (segment) => segment.trim(),
      ),
    ),
  );
  /* Generous per-glyph width so a group never runs off its probe; widest
     glyphs (W, emoji, CJK) advance about 1.2em plus tracking, and the
     space after each about 0.3em. */
  const perGlyph = look.fontSize * (1.7 + Math.max(0, look.letterSpacing) * 2);
  const perGroup = Math.max(
    1,
    Math.floor((MAX_INK_PROBE_WIDTH - look.fontSize * 4) / perGlyph),
  );
  const groups: string[] = [];
  for (let i = 0; i < unique.length; i += perGroup) {
    groups.push(unique.slice(i, i + perGroup).join(" "));
  }
  return groups;
}

function isMarker(pixels: Uint8Array, at: number): boolean {
  return pixels[at] > 200 && pixels[at + 1] < 60 && pixels[at + 2] < 60;
}

function marker(): ReactElement {
  return (
    <div
      style={{
        width: MARKER,
        height: MARKER,
        flexShrink: 0,
        backgroundColor: "#FF0000",
      }}
    />
  );
}

function runStyle(look: TextLook, line?: { width: number; text: string }) {
  return {
    ...textRunStyle({ ...look, color: "#000000" }, undefined, line),
    flexShrink: 0,
  };
}

export interface RendererMeasurerOptions {
  fonts: LoadedFont[];
  /** The limit counts from the moment a worker takes the probe, so a cold
   *  worker's start and its fallback-face fetches spend it too. Tests on a
   *  loaded machine pass a looser one (TEST_PROBE_LIMIT_MS); a probe that
   *  loops never finishes, so a looser limit still catches it. */
  probeLimitMs?: number;
}

export interface RendererMeasurer extends TextMeasurer {
  /** Probes actually rendered, for cost reporting. Cache hits do not count. */
  probes(): number;
}

export function createRendererMeasurer({
  fonts,
  probeLimitMs = PROBE_LIMIT_MS,
}: RendererMeasurerOptions): RendererMeasurer {
  const cache = new Map<string, Promise<unknown>>();
  let rendered = 0;

  async function probe<T>(
    element: ReactElement,
    size: { width: number; height: number },
    read: (png: { width: number; height: number; pixels: Uint8Array }) => T,
  ): Promise<T> {
    rendered += 1;
    const png = decodePngRgba(
      await renderPng(element, size, fonts, { limitMs: probeLimitMs }),
    );
    if (!png) throw new Error("Text probe did not produce a readable PNG");
    return read(png);
  }

  /* Scans down column 1 for the marker. Not found means the run pushed it
     past the probe, which the caller treats as infinitely tall. */
  const readDown = (png: {
    width: number;
    height: number;
    pixels: Uint8Array;
  }) => {
    for (let y = 0; y < png.height; y += 1) {
      if (isMarker(png.pixels, (y * png.width + 1) * 4)) return y;
    }
    return Number.POSITIVE_INFINITY;
  };
  const readAcross = (png: {
    width: number;
    height: number;
    pixels: Uint8Array;
  }) => {
    for (let x = 0; x < png.width; x += 1) {
      if (isMarker(png.pixels, (png.width + x) * 4)) return x;
    }
    return Number.POSITIVE_INFINITY;
  };

  function memo<T>(key: string, run: () => Promise<T>): Promise<T> {
    const hit = cache.get(key) as Promise<T> | undefined;
    if (hit) return hit;
    const pending = run();
    cache.set(key, pending);
    /* A failed probe must not be cached: the next caller should see the real
       error again, not a stale rejected promise from a different render. */
    pending.catch(() => cache.delete(key));
    return pending;
  }

  return {
    probes: () => rendered,

    height(text, look, width) {
      const w = Math.max(1, Math.floor(width));
      return memo(JSON.stringify(["h", text, look, w]), () =>
        probe(
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              width: 8,
              height: MAX_PROBE,
              backgroundColor: "#FFFFFF",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                width: w,
                flexShrink: 0,
              }}
            >
              <div style={runStyle(look, { width: w, text })}>
                {breakableText(text)}
              </div>
            </div>
            {marker()}
          </div>,
          { width: 8, height: MAX_PROBE },
          readDown,
        ),
      );
    },

    lineWidth(text, look) {
      return memo(JSON.stringify(["w", text, look]), () =>
        probe(
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-start",
              width: MAX_PROBE,
              height: MARKER,
              backgroundColor: "#FFFFFF",
            }}
          >
            <div
              style={{
                ...runStyle(look),
                whiteSpace: "nowrap",
                textWrap: "wrap",
              }}
            >
              {breakableText(text)}
            </div>
            {marker()}
          </div>,
          { width: MAX_PROBE, height: MARKER },
          readAcross,
        ),
      );
    },

    inkExtent(text, look) {
      const pad = Math.ceil(look.fontSize * 1.5);
      const line = lineBox(look);
      const groups = glyphGroups(text, look);
      if (groups.length === 0) return Promise.resolve({ above: 0, below: 0 });
      return memo(JSON.stringify(["ink", groups, look]), async () => {
        let reach: InkExtent = { above: 0, below: 0 };
        for (const group of groups) {
          const width = Math.min(
            MAX_INK_PROBE_WIDTH,
            pad * 2 +
              Math.ceil(
                Array.from(group.replaceAll(" ", "")).length *
                  look.fontSize *
                  (1.7 + Math.max(0, look.letterSpacing) * 2),
              ),
          );
          const height = line + pad * 2;
          const found = await probe(
            <div
              style={{
                display: "flex",
                width,
                height,
                backgroundColor: "#FFFFFF",
                paddingTop: pad,
                paddingLeft: pad,
              }}
            >
              <div
                style={{
                  ...runStyle(look),
                  whiteSpace: "nowrap",
                  height: line,
                }}
              >
                {group}
              </div>
            </div>,
            { width, height },
            (png): InkExtent | null => {
              let top = Number.POSITIVE_INFINITY;
              let bottom = Number.NEGATIVE_INFINITY;
              for (let y = 0; y < png.height; y += 1) {
                for (let x = 0; x < png.width; x += 1) {
                  if (!isInk(png.pixels, (y * png.width + x) * 4)) continue;
                  top = Math.min(top, y);
                  bottom = Math.max(bottom, y + 1);
                  break;
                }
              }
              return Number.isFinite(top)
                ? { above: pad - top, below: bottom - (pad + line) }
                : null;
            },
          );
          if (!found) continue;
          reach = {
            above: Math.max(reach.above, found.above),
            below: Math.max(reach.below, found.below),
          };
        }
        return reach;
      });
    },

    widestWord(text, look) {
      const words = Array.from(new Set(unbreakableRuns(text)));
      if (words.length === 0) return Promise.resolve(0);
      return memo(JSON.stringify(["ww", words, look]), () =>
        probe(
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-start",
              width: MAX_PROBE,
              height: MARKER,
              backgroundColor: "#FFFFFF",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                flexShrink: 0,
              }}
            >
              {words.map((word) => (
                <div
                  key={word}
                  style={{
                    ...runStyle(look),
                    whiteSpace: "nowrap",
                    textWrap: "wrap",
                  }}
                >
                  {word}
                </div>
              ))}
            </div>
            {marker()}
          </div>,
          { width: MAX_PROBE, height: MARKER },
          readAcross,
        ),
      );
    },
  };
}
