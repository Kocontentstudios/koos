// @vitest-environment node
import { ImageResponse } from "next/og";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { documentElement } from "@/lib/design/document/render";
import type { DesignDocument, TextElement } from "@/lib/design/document/schema";
import { cacheOgAssets } from "@/lib/design/document/testing-og-assets";
import { decodePngRgba } from "@/lib/images/png-pixels";
import { type LoadedFont, loadBrandFonts } from "./fonts";
import {
  closeRenderPool,
  RenderTimeoutError,
  renderPng,
  renderPoolStats,
  toPlainTree,
} from "./satori-pool";

/**
 * The render worker: no input can hold the event loop, a render past its
 * limit is stopped, and the pool recovers for the next one.
 *
 * The hostile input is the shape that loops satori forever: break-word on
 * a line narrower than one grapheme cluster (six conjoining jamo, drawn as
 * six letters). The schema refuses that cluster and the layer renderer
 * never breaks words on so narrow a line (document/render.tsx), so it is
 * built here by hand, past both, as the case the workers exist for.
 */

cacheOgAssets();

let fonts: LoadedFont[];
beforeAll(async () => {
  fonts = await loadBrandFonts(null);
});
afterAll(closeRenderPool);

const CANVAS = { width: 1080, height: 1080 };

function textDoc(text: string, width: number): DesignDocument {
  const element: TextElement = {
    id: "t",
    name: "Text",
    type: "text",
    x: 10,
    y: 10,
    width,
    height: 900,
    rotation: 0,
    opacity: 1,
    hidden: false,
    locked: false,
    text,
    role: "headline",
    font: "heading",
    fontSize: 100,
    fontWeight: 700,
    lineHeight: 1.1,
    letterSpacing: 0,
    align: "left",
    italic: false,
    color: "#000000",
  };
  return { version: 1, ...CANVAS, background: "#FFFFFF", elements: [element] };
}

function hangingElement() {
  return (
    <div style={{ display: "flex", width: 300 }}>
      <div style={{ fontSize: 100, wordBreak: "break-word" }}>
        {"ᄀ".repeat(6)}
      </div>
    </div>
  );
}

describe("renderPng", () => {
  it("draws what the main thread would draw", async () => {
    const element = documentElement(textDoc("Fresh croissants", 900), {});
    const pooled = decodePngRgba(await renderPng(element, CANVAS, fonts));
    const direct = decodePngRgba(
      new Uint8Array(
        await new ImageResponse(element, {
          ...CANVAS,
          fonts: fonts.map(({ name, data, weight, style }) => ({
            name,
            data,
            weight,
            style,
          })),
        }).arrayBuffer(),
      ),
    );
    expect(pooled?.width).toBe(CANVAS.width);
    /* toEqual on two 4.7 MB buffers took 10s and timed the test out under
       load; a byte compare says the same thing in milliseconds. */
    expect(
      Buffer.compare(
        Buffer.from(pooled?.pixels ?? []),
        Buffer.from(direct?.pixels ?? []),
      ),
    ).toBe(0);
  }, 60_000);

  it("stops a render that never returns, without blocking the event loop, and recovers", async () => {
    const before = renderPoolStats();
    let ticks = 0;
    const ticker = setInterval(() => {
      ticks += 1;
    }, 50);
    const started = performance.now();
    const hang = renderPng(hangingElement(), CANVAS, fonts, {
      limitMs: 2_000,
    });
    await expect(hang).rejects.toBeInstanceOf(RenderTimeoutError);
    const waited = performance.now() - started;
    clearInterval(ticker);
    expect(waited).toBeGreaterThanOrEqual(1_900);
    expect(waited).toBeLessThan(6_000);
    /* 50ms ticks over two seconds: the main thread kept running. */
    expect(ticks).toBeGreaterThan(20);

    const after = renderPoolStats();
    expect(after.timeouts).toBe(before.timeouts + 1);

    const next = await renderPng(
      documentElement(textDoc("Still drawing", 900), {}),
      CANVAS,
      fonts,
    );
    expect(decodePngRgba(next)?.width).toBe(CANVAS.width);
    expect(renderPoolStats().workers).toBeLessThanOrEqual(
      renderPoolStats().size,
    );
  }, 60_000);

  /* Round 3 had one worker: one stuck document held five ordinary renders
     queued behind it for the whole limit. */
  it("keeps drawing other renders while one runs to its limit", async () => {
    expect(renderPoolStats().size).toBeGreaterThanOrEqual(2);
    const started = performance.now();
    const hang = renderPng(hangingElement(), CANVAS, fonts, {
      limitMs: 8_000,
    }).catch((error: unknown) => error);
    const ordinary = await Promise.all(
      ["One", "Two", "Three", "Four", "Five"].map(async (word) => {
        await renderPng(documentElement(textDoc(word, 900), {}), CANVAS, fonts);
        return performance.now() - started;
      }),
    );
    expect(Math.max(...ordinary)).toBeLessThan(5_000);
    expect(await hang).toBeInstanceOf(RenderTimeoutError);
  }, 60_000);

  it("rejects with the renderer's own message when satori throws, and keeps the worker", async () => {
    await renderPng(documentElement(textDoc("Warm", 900), {}), CANVAS, fonts);
    const spawns = renderPoolStats().spawns;
    await expect(
      renderPng(
        documentElement(textDoc("مرحبا بالعالم", 900), {}),
        CANVAS,
        fonts,
      ),
    ).rejects.toThrow(/lookupType/);
    await renderPng(documentElement(textDoc("After", 900), {}), CANVAS, fonts);
    expect(renderPoolStats().spawns).toBe(spawns);
  }, 60_000);

  it("runs queued renders, each with its own result", async () => {
    const words = ["One", "Two", "Three", "Four"];
    const results = await Promise.all(
      words.map((word) =>
        renderPng(
          documentElement(textDoc(word, 900), {}),
          { width: 200 + words.indexOf(word), height: 200 },
          fonts,
        ),
      ),
    );
    expect(results.map((png) => decodePngRgba(png)?.width)).toEqual([
      200, 201, 202, 203,
    ]);
  }, 60_000);
});

describe("toPlainTree", () => {
  it("calls function components and drops what satori never reads", () => {
    function Box({ label }: { label: string }) {
      return <div style={{ display: "flex" }}>{label}</div>;
    }
    expect(
      toPlainTree(
        <>
          <Box label="a" />
          {false}
          {null}
          <span key="k">b</span>
        </>,
      ),
    ).toEqual([
      { type: "div", props: { style: { display: "flex" }, children: "a" } },
      null,
      null,
      { type: "span", props: { children: "b" } },
    ]);
  });
});
