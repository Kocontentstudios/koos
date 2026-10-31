// @vitest-environment node
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ABORTS_RAW,
  hostileSvgLogos,
  paletteCrashPng,
  svgLogo,
} from "./hostile-svg-fixtures";
import { buildJpeg } from "./image-fixtures";
import { type ImageToDraw, renderInChild } from "./render-in-child";
import { sanitizeSvg, UnsafeSvgError } from "./svg-sanitize";

/**
 * FEAT-033 round-3 critic, B8: an SVG logo embedding the round-2 palette
 * crash aborted the renderer process (exit 134) through rasterizeSvg, from
 * loadBrandLogo in every design job and from POST /api/brand/logo-colors. The
 * gate: the critic's SVGs are refused, and everything the sanitiser lets
 * through is drawn by the real next/og in a child process without killing it.
 */

const SVG = "image/svg+xml";
const svgImage = (name: string, svg: string | Uint8Array): ImageToDraw => ({
  name,
  contentType: SVG,
  bytes: typeof svg === "string" ? new TextEncoder().encode(svg) : svg,
});

describe("the child-process render gate, handed raw SVG logos", () => {
  let hostile: Record<string, string>;
  beforeAll(async () => {
    hostile = hostileSvgLogos(await paletteCrashPng());
  });

  /* Proof the gate can fail: each critic file, unsanitised, still kills the
     renderer, so a sanitiser that let one through would be caught here. */
  it.each(ABORTS_RAW)(
    "sees %s abort the renderer",
    (name) => {
      const run = renderInChild([
        svgImage("control", svgLogo()),
        svgImage(name, hostile[name]),
      ]);
      expect(run.status).not.toBe(0);
      expect(run.lastStarted).toBe(name);
      expect(run.stderr).toMatch(/panicked/);
    },
    60_000,
  );
});

describe("sanitised SVG logos survive the renderer", () => {
  let hostile: Record<string, string>;
  let drawable: ImageToDraw[];

  beforeAll(async () => {
    hostile = hostileSvgLogos(await paletteCrashPng());
    const png = await sharp({
      create: { width: 40, height: 40, channels: 4, background: "#f97316cc" },
    })
      .png()
      .toBuffer();
    const sources: Record<string, string> = {
      plain: svgLogo(),
      "embeds-png": svgLogo(
        `<image width="40" height="40" href="data:image/png;base64,${png.toString("base64")}"/>`,
      ),
      "embeds-jpeg-xlink": svgLogo(
        `<image width="40" height="40" xlink:href="data:image/jpeg;base64,${buildJpeg(40, 40).toString("base64")}"/>`,
      ),
      "gradient-use-style": svgLogo(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#0ff"/><stop offset="1" stop-color="#f0f"/></linearGradient><circle id="d" r="10"/></defs><style>.x{fill:url(#g)}</style><use href="#d" x="150" y="40" class="x"/>',
      ),
    };
    drawable = [];
    for (const [name, svg] of Object.entries(sources)) {
      const safe = await sanitizeSvg(new TextEncoder().encode(svg));
      drawable.push(svgImage(name, safe.bytes));
    }
  });

  it("refuses every file the critic used to abort or reach out", async () => {
    const accepted: string[] = [];
    for (const [name, svg] of Object.entries(hostile)) {
      const err = await sanitizeSvg(new TextEncoder().encode(svg)).catch(
        (e: unknown) => e,
      );
      if (!(err instanceof UnsafeSvgError)) accepted.push(name);
    }
    expect(accepted).toEqual([]);
  });

  it("draws every logo it lets through, and the renderer survives", () => {
    const run = renderInChild(drawable);
    expect(
      { status: run.status, signal: run.signal, last: run.lastStarted },
      run.stderr.slice(-2000),
    ).toEqual({ status: 0, signal: null, last: drawable.at(-1)?.name });
    expect(Object.values(run.verdicts)).toEqual(drawable.map(() => "drawn"));
  }, 60_000);

  /* The sanitiser rebuilds the document; a logo that came out looking
     different would be a quiet regression on every brand with an SVG. */
  it("draws a clean logo exactly as the original does", () => {
    const original = svgImage(
      "original",
      svgLogo(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#0ff"/><stop offset="1" stop-color="#f0f"/></linearGradient><circle id="d" r="10"/></defs><style>.x{fill:url(#g)}</style><use href="#d" x="150" y="40" class="x"/>',
      ),
    );
    const rebuilt = drawable.find((d) => d.name === "gradient-use-style");
    if (!rebuilt) throw new Error("fixture missing");
    const run = renderInChild([original, rebuilt]);
    expect(run.status).toBe(0);
    expect(run.verdicts.original).toBe("drawn");
    expect(run.digests.original).toBe(run.digests["gradient-use-style"]);
  }, 60_000);
});
