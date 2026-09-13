import { ImageResponse } from "next/og";
import { decodePngRgba, inkBoxOf, readInk } from "@/lib/images/png-pixels";

export interface LogoProbe {
  /** False when the renderer put down no ink at all — it declined the file. */
  drawable: boolean;
  /** Darkest and lightest ink in the mark, at the 5th/95th percentiles. NaN
   *  when nothing drew. A mark carrying both dark and light ink is legible on
   *  far more grounds than its mean suggests. */
  darkest: number;
  lightest: number;
  /** Width over height of the ink itself.
   *
   * Read off the probe render rather than the file's own header, because the
   * header is only readable for the one format our decoder handles. A JPEG, a
   * 16-bit PNG and an interlaced PNG all decode to nothing and were silently
   * called square, which shrank a 3:1 wordmark to 55% of its size and turned
   * its backing plate into a square slab. The probe has already drawn it; the
   * ink box is the honest answer for every format. */
  aspect: number;
}

/** Probe canvas. Large enough that a 20:1 wordmark still lands on several
 * pixels of height, small enough to be free. */
const PROBE_SIZE = 512;

/* Antialiasing can leave a stray pixel or two around an edge. Anything at or
   above this is a real mark.

   NOT a share of the box. A coverage floor was the first attempt and it was
   the wrong instrument: a 20:1 wordmark and a mark sitting inside a large
   artboard both put down real ink over a tiny fraction of the frame, so the
   floor deleted logos the renderer draws perfectly and told the user their
   file was damaged — the reported bug back again, with a worse message. The
   only question the probe can honestly answer is "did anything appear". */
const MIN_INK_PIXELS = 4;

/**
 * Draws the logo once, on its own, and looks at the result.
 *
 * This exists because resvg does not fail loudly. Handed an image node it
 * cannot decode — a damaged IDAT, a truncated upload, a CMYK JPEG out of
 * Illustrator — it skips the node and returns a perfectly valid PNG of
 * everything else. So the design rendered, the logo was absent, nothing threw,
 * and the user was told nothing: the original bug, reproduced downstream of
 * its own fix. Catching the exception was never going to be enough, because
 * there is no exception.
 *
 * One render per generation, not per variant, and it answers two questions at
 * once: did it draw, and how light is it.
 */
export async function probeLogo(logo: {
  bytes: Uint8Array;
  contentType: string;
}): Promise<LogoProbe> {
  const empty: LogoProbe = {
    drawable: false,
    darkest: Number.NaN,
    lightest: Number.NaN,
    aspect: 1,
  };
  const uri = `data:${logo.contentType};base64,${Buffer.from(logo.bytes).toString("base64")}`;

  try {
    const response = new ImageResponse(
      {
        type: "div",
        props: {
          style: {
            display: "flex",
            width: `${PROBE_SIZE}px`,
            height: `${PROBE_SIZE}px`,
            background: "transparent",
          },
          children: {
            type: "img",
            props: {
              src: uri,
              width: PROBE_SIZE,
              height: PROBE_SIZE,
              style: { objectFit: "contain" },
            },
          },
        },
      } as never,
      { width: PROBE_SIZE, height: PROBE_SIZE },
    );

    const decoded = decodePngRgba(new Uint8Array(await response.arrayBuffer()));
    if (!decoded) return empty;

    const ink = readInk(decoded);
    const drawnPixels = Math.round(
      ink.coverage * decoded.width * decoded.height,
    );
    if (drawnPixels < MIN_INK_PIXELS) return empty;

    const box = inkBoxOf(decoded);
    return {
      drawable: true,
      darkest: ink.darkest,
      lightest: ink.lightest,
      aspect: box ? box.width / box.height : 1,
    };
  } catch {
    return empty;
  }
}
