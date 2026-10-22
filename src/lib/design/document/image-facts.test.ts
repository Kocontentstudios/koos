import { describe, expect, it } from "vitest";
import { subjectCells } from "./image-facts";

/**
 * The subject box read from a cut-out's alpha leaves out what a bad cut
 * leaves behind. Round 3 boxed every cell with any alpha, and a 6px dot in a
 * corner or a faint veil over the whole file grew the box to the frame, so
 * the real product was laid out at 12-22% of the canvas with no fault.
 */

const COLS = 96;
const ROWS = 96;

function grid(paint: (x: number, y: number) => number) {
  const alpha = new Uint8Array(COLS * ROWS);
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) alpha[y * COLS + x] = paint(x, y);
  }
  return { cols: COLS, rows: ROWS, alpha: (i: number) => alpha[i] };
}

const inDisc = (x: number, y: number) => Math.hypot(x - 48, y - 48) < 14;
const DISC = { left: 35, top: 35, right: 62, bottom: 62 };

describe("subjectCells", () => {
  it.each([
    ["a clean cut", () => 0],
    ["a dot in a corner", (x: number, y: number) => (x < 1 && y < 1 ? 255 : 0)],
    [
      "a 2-cell dot near the bottom",
      (x: number, y: number) =>
        x >= 2 && x < 4 && y >= 92 && y < 94 ? 255 : 0,
    ],
    [
      "a hairline along the top edge",
      (_x: number, y: number) => (y < 2 ? 255 : 0),
    ],
    [
      "a hairline down the side",
      (x: number, y: number) => (x === 90 && y > 10 && y < 80 ? 255 : 0),
    ],
    ["a faint veil over the whole file", () => 10],
    ["a heavier veil", () => 30],
  ])("boxes only the product under %s", (_name, debris) => {
    const box = subjectCells(
      grid((x, y) => (inDisc(x, y) ? 255 : debris(x, y))),
    );
    expect(box).toEqual(DISC);
  });

  it("keeps a soft shadow, which is part of the subject", () => {
    const box = subjectCells(
      grid((x, y) =>
        inDisc(x, y) ? 255 : y > 60 && y < 70 && x > 30 && x < 66 ? 40 : 0,
      ),
    );
    expect(box).toEqual({ ...DISC, left: 31, right: 66, bottom: 70 });
  });

  it("keeps a second product of real weight", () => {
    const box = subjectCells(
      grid((x, y) =>
        inDisc(x, y) || (x >= 70 && x < 80 && y >= 40 && y < 56) ? 255 : 0,
      ),
    );
    expect(box).toEqual({ ...DISC, right: 80 });
  });

  it("finds nothing in a fully transparent file", () => {
    expect(subjectCells(grid(() => 0))).toBeNull();
  });
});
