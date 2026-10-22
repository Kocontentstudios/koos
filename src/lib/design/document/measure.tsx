import { ImageResponse } from "next/og";
import type { ReactElement } from "react";
import type { LoadedFont } from "@/lib/design/render/fonts";
import { decodePngRgba } from "@/lib/images/png-pixels";
import { type TextLook, type TextMeasurer, unbreakableRuns } from "./fit";
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

function runStyle(look: TextLook, lineWidth?: number) {
  return {
    ...textRunStyle({ ...look, color: "#000000" }, undefined, lineWidth),
    flexShrink: 0,
  };
}

export interface RendererMeasurerOptions {
  fonts: LoadedFont[];
}

export interface RendererMeasurer extends TextMeasurer {
  /** Probes actually rendered, for cost reporting. Cache hits do not count. */
  probes(): number;
}

export function createRendererMeasurer({
  fonts,
}: RendererMeasurerOptions): RendererMeasurer {
  /* One array for every probe: satori caches parsed fonts per options
     object, and re-parsing the faces on each probe would cost more than the
     probe itself. */
  const fontOptions =
    fonts.length > 0
      ? fonts.map((f) => ({
          name: f.name,
          data: f.data,
          weight: f.weight,
          style: f.style,
        }))
      : undefined;
  const cache = new Map<string, Promise<number>>();
  let rendered = 0;

  async function probe(
    element: ReactElement,
    size: { width: number; height: number },
    read: (png: {
      width: number;
      height: number;
      pixels: Uint8Array;
    }) => number,
  ): Promise<number> {
    rendered += 1;
    const response = new ImageResponse(element, {
      ...size,
      ...(fontOptions ? { fonts: fontOptions } : {}),
    });
    const png = decodePngRgba(new Uint8Array(await response.arrayBuffer()));
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

  function memo(key: string, run: () => Promise<number>): Promise<number> {
    const hit = cache.get(key);
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
              <div style={runStyle(look, w)}>{text}</div>
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
              {text}
            </div>
            {marker()}
          </div>,
          { width: MAX_PROBE, height: MARKER },
          readAcross,
        ),
      );
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
