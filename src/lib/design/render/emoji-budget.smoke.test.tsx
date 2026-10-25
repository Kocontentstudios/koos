// @vitest-environment node
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
 * its count would reach the worker. Emoji are stubbed in the worker so the
 * test needs no network.
 */

const CANVAS = { width: 1080, height: 1350 };
let fonts: LoadedFont[];

beforeAll(async () => {
  await closeRenderPool();
  process.env.KOOS_OG_STUB_EMOJI = "1";
  fonts = await loadBrandFonts(null);
});
afterAll(async () => {
  await closeRenderPool();
  delete process.env.KOOS_OG_STUB_EMOJI;
});

/* Distinct pictographs, spaced so none joins another; an offset keeps each
   test's pictures out of the worker's memory from the test before. */
const distinct = (count: number, offset: number) =>
  Array.from({ length: count }, (_, i) =>
    String.fromCodePoint(0x1f400 + offset + i),
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
