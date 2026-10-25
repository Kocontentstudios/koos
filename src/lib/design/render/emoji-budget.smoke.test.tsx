// @vitest-environment node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { designOfRuns } from "@/lib/design/document/emoji-shapes";
import { documentElement } from "@/lib/design/document/render";
import { MAX_EMOJI_PER_DOCUMENT } from "@/lib/design/document/text-safety";
import { type LoadedFont, loadBrandFonts } from "./fonts";
import {
  closeRenderPool,
  EmojiBudgetError,
  MAX_EMOJI_FETCHES_PER_RENDER,
  renderPng,
} from "./satori-pool";

/**
 * The render worker refuses the emoji picture past its budget, whatever the
 * copy. Rendered here with raw text the schema never saw, as a bypass of
 * its count would reach the worker. The worker's network is faked under its
 * real fetch path (budget, disk cache, retries), so production's path is
 * what is tested and no request leaves the machine.
 */

const CANVAS = { width: 1080, height: 1350 };
let fonts: LoadedFont[];
let diskCache: string;

/** Fresh workers, with no picture in memory, on the given fake network. */
async function freshWorkers(network: string) {
  await closeRenderPool();
  process.env.KOOS_OG_FAKE_NETWORK = network;
  process.env.KOOS_OG_ASSET_CACHE = diskCache;
}

beforeAll(async () => {
  diskCache = await mkdtemp(join(tmpdir(), "koos-emoji-budget-"));
  await freshWorkers("ok");
  fonts = await loadBrandFonts(null);
});
afterAll(async () => {
  await closeRenderPool();
  delete process.env.KOOS_OG_FAKE_NETWORK;
  delete process.env.KOOS_OG_ASSET_CACHE;
});

/* Distinct pictographs, spaced so none joins another; an offset keeps each
   test's pictures out of the worker's memory from the test before. */
const distinct = (count: number, offset: number) =>
  Array.from({ length: count }, (_, i) =>
    String.fromCodePoint(0x1f400 + offset + i),
  ).join(" ");

/* Faces from the emoticons block, where every code point is an emoji
   picture, so a count of them is a count of fetches. */
const faces = (count: number, offset: number) =>
  Array.from({ length: count }, (_, i) =>
    String.fromCodePoint(0x1f600 + offset + i),
  ).join(" ");

const page = (text: string) => (
  <div
    style={{
      display: "flex",
      width: CANVAS.width,
      height: CANVAS.height,
      fontSize: 32,
      background: "#FFFFFF",
    }}
  >
    {text}
  </div>
);

describe("the emoji budget in the render worker", () => {
  it("counts a picture read from the disk cache, as production does", async () => {
    /* Drawn once to put 24 pictures on disk, then asked for again by fresh
       workers with nothing in memory, plus one more. */
    await freshWorkers("ok");
    await renderPng(
      page(faces(MAX_EMOJI_FETCHES_PER_RENDER, 0)),
      CANVAS,
      fonts,
    );
    await freshWorkers("ok");
    await expect(
      renderPng(
        page(faces(MAX_EMOJI_FETCHES_PER_RENDER + 1, 0)),
        CANVAS,
        fonts,
      ),
    ).rejects.toBeInstanceOf(EmojiBudgetError);
  }, 60_000);

  it("really fails a fetch in the 503 mode the retry test relies on", async () => {
    /* Without this, the fake's 503 branch could stop firing and the retry
       test below would pass without ever retrying. */
    await freshWorkers("503-always");
    const outcome = renderPng(page(faces(1, 70)), CANVAS, fonts);
    await expect(outcome).rejects.toThrow(/503/);
    await expect(outcome).rejects.not.toBeInstanceOf(EmojiBudgetError);
    await freshWorkers("ok");
  }, 60_000);

  it.each([["0"], ["false"], ["off"]])(
    "refuses to start on %s, which would otherwise switch the fake network on",
    async (value) => {
      await freshWorkers(value);
      await expect(
        renderPng(page(faces(1, 72)), CANVAS, fonts),
      ).rejects.toThrow();
      await freshWorkers("ok");
    },
    60_000,
  );

  it("refuses to start with the fake network under NODE_ENV=production", async () => {
    const env = process.env.NODE_ENV;
    await freshWorkers("ok");
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      await expect(
        renderPng(page(faces(1, 74)), CANVAS, fonts),
      ).rejects.toThrow();
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = env;
      await freshWorkers("ok");
    }
  }, 60_000);

  it("counts a picture once when its first fetch fails and is retried", async () => {
    /* A retried fetch counted twice would refuse a legitimate design
       whenever the CDN wobbles. */
    await freshWorkers("503-once");
    const png = await renderPng(
      page(faces(MAX_EMOJI_FETCHES_PER_RENDER, 40)),
      CANVAS,
      fonts,
    );
    expect(png.length).toBeGreaterThan(0);
    await freshWorkers("ok");
  }, 60_000);

  it("is the schema's per-design cap", () => {
    expect(MAX_EMOJI_FETCHES_PER_RENDER).toBe(MAX_EMOJI_PER_DOCUMENT);
  });

  it("draws a render that fetches the budget's worth of pictures", async () => {
    const png = await renderPng(
      page(distinct(MAX_EMOJI_FETCHES_PER_RENDER, 0)),
      CANVAS,
      fonts,
    );
    expect(png.length).toBeGreaterThan(0);
  }, 60_000);

  it("refuses the picture past the budget and fails the render", async () => {
    await expect(
      renderPng(
        page(distinct(MAX_EMOJI_FETCHES_PER_RENDER + 1, 100)),
        CANVAS,
        fonts,
      ),
    ).rejects.toBeInstanceOf(EmojiBudgetError);
  }, 60_000);

  it("fails closed on round 6i's bypass: tones that join the emoji before them", async () => {
    /* The critic's design as raw copy, which a bypass of the schema would
       deliver: each run ends in an emoji and the next starts with a toned
       VS16, which next/og glues on. Counted 24, it fetches 30. A fresh
       worker, so no picture is already in its memory from a test before. */
    await closeRenderPool();
    const hands = Array.from("👋👍✋👌👏🙏💪👂👃👶🧒👦👧👨👩🧑👴👵🙋🙌🤞🤟🤙");
    const lead = "\u{1F3FD}\uFE0F";
    const runs = Array.from({ length: 8 }, (_, i) =>
      [
        i === 0 ? "" : lead,
        ...hands.slice(i * 3, i * 3 + 3),
        i < 7 ? hands[i] : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
    await expect(
      renderPng(documentElement(designOfRuns(runs), {}), CANVAS, fonts),
    ).rejects.toBeInstanceOf(EmojiBudgetError);
  }, 60_000);

  it("leaves nothing blank behind: the refused pictures draw in the next render", async () => {
    await expect(
      renderPng(page(distinct(40, 200)), CANVAS, fonts),
    ).rejects.toBeInstanceOf(EmojiBudgetError);
    const png = await renderPng(
      page(distinct(MAX_EMOJI_FETCHES_PER_RENDER, 200 + 16)),
      CANVAS,
      fonts,
    );
    expect(png.length).toBeGreaterThan(0);
  }, 60_000);
});
