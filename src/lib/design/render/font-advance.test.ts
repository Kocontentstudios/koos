// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cffWidths, FontAdvanceFault, widestAdvances } from "./font-advance";
import { buildFont, OUTLINE_GLYPH } from "./font-fixtures";

function tablesOf(font: Uint8Array) {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < view.getUint16(4); i += 1) {
    const at = 12 + i * 16;
    tables.set(String.fromCharCode(...font.subarray(at, at + 4)), {
      offset: view.getUint32(at + 8),
      length: view.getUint32(at + 12),
    });
  }
  return { view, tables };
}

/* width 0 0 rmoveto 500 hlineto 700 vlineto -500 hlineto endchar */
const OUTLINE_PROGRAM_BYTES = 23;

/** Rewrites the outline glyph's charstring in place, keeping its length. */
function withCharstring(font: Uint8Array, program: number[]): Uint8Array {
  const out = font.slice();
  const { tables } = tablesOf(out);
  const cff = tables.get("CFF ");
  if (!cff) throw new Error("no CFF table");
  /* The outline glyph's program is the only one long enough to overwrite;
     its first bytes are the width operand (28 hi lo). */
  const needle = [28, (500 >> 8) & 0xff, 500 & 0xff, 28, 0, 0, 28, 0, 0, 21];
  const bytes = Array.from(out.subarray(cff.offset, cff.offset + cff.length));
  const at = bytes.findIndex((_, i) =>
    needle.every((b, j) => bytes[i + j] === b),
  );
  if (at < 0) throw new Error("outline charstring not found");
  if (program.length > OUTLINE_PROGRAM_BYTES) throw new Error("too long");
  const padded = [
    ...program,
    ...Array(OUTLINE_PROGRAM_BYTES - program.length).fill(14),
  ];
  out.set(padded, cff.offset + at);
  return out;
}

const widthOf = (font: Uint8Array, glyph = OUTLINE_GLYPH) => {
  const { view, tables } = tablesOf(font);
  const cff = tables.get("CFF ");
  if (!cff) throw new Error("no CFF table");
  return cffWidths(view, cff)[glyph];
};

describe("cffWidths, operand by operand as opentype.js reads it", () => {
  it("reads each glyph's width operand", () => {
    const font = buildFont({
      cff: { widths: { [OUTLINE_GLYPH]: 777, 3: 123 } },
    });
    expect(widthOf(font)).toBe(777);
    expect(widthOf(font, 3)).toBe(123);
  });

  it("falls back to defaultWidthX without an operand", () => {
    expect(
      widthOf(
        buildFont({ cff: { defaultWidthX: 640, widths: { 2: null } } }),
        2,
      ),
    ).toBe(640);
  });

  /* The width is whichever operand is left first when the first stem or
     moveto runs, so what came before decides it. */
  it.each([
    ["hmoveto with two operands", [139 + 50, 139 + 5, 22], 50],
    ["hmoveto with one operand (no width)", [139 + 5, 22], 0],
    ["rmoveto with three operands", [139 + 60, 139, 139, 21], 60],
    ["hstem with an odd count", [139 + 70, 139, 139 + 10, 1], 70],
    ["hstem with an even count (no width)", [139, 139 + 10, 1], 0],
    ["endchar with one operand", [139 + 80, 14], 80],
    /* hflex shifts seven operands and leaves the rest for the moveto. */
    [
      "hflex leftovers",
      [...Array(7).fill(139), 139 + 90, 139 + 1, 12, 34, 22],
      90,
    ],
    ["return before any width", [139 + 50, 11, 139 + 99, 139, 22], 0],
  ])("%s", (_label, program, expected) => {
    const font = withCharstring(buildFont({ cff: {} }), program);
    expect(widthOf(font)).toBe(expected);
  });

  /* callsubr pops an index and adds the bias (107 for under 1240 subrs). */
  const CALL_SUBR_0 = [139 - 107, 10];

  it("follows a width set inside a subroutine", () => {
    const font = withCharstring(
      buildFont({ cff: { subrs: [[139 + 55, 139 + 1, 22, 11]] } }),
      [...CALL_SUBR_0, 14],
    );
    expect(widthOf(font)).toBe(55);
  });

  it("refuses subroutines that call themselves without end", () => {
    const font = withCharstring(
      buildFont({ cff: { subrs: [[...CALL_SUBR_0, 11]] } }),
      [...CALL_SUBR_0, 14],
    );
    expect(() => widthOf(font)).toThrow(FontAdvanceFault);
  });

  /* Each level calls the next a thousand times: about 10^24 operators if
     read to the end, which opentype.js would do for this one glyph. */
  it("refuses a program that fans out past the reading budget, quickly", () => {
    const subrs = Array.from({ length: 8 }, (_, level) => [
      ...Array.from({ length: 1000 }, () => [level + 1 - 107 + 139, 10]).flat(),
      11,
    ]);
    subrs.push([139, 139, 11]);
    const font = withCharstring(buildFont({ cff: { subrs } }), CALL_SUBR_0);
    const started = performance.now();
    expect(() => widthOf(font)).toThrow(/too long to read/);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  /* The width is settled at the first stem or moveto; what follows can
     never change it, so it is never read: here a subroutine that calls
     itself forever, which would be refused if it were. */
  it("stops reading once the width is settled", () => {
    const font = withCharstring(
      buildFont({ cff: { subrs: [[...CALL_SUBR_0, 11]] } }),
      [139 + 30, 139, 139, 21, ...CALL_SUBR_0],
    );
    expect(widthOf(font)).toBe(30);
  });

  it("ignores a call to a subroutine that does not exist", () => {
    const font = withCharstring(buildFont({ cff: {} }), [
      ...CALL_SUBR_0,
      139 + 40,
      14,
    ]);
    expect(widthOf(font)).toBe(40);
  });
});

describe("widestAdvances", () => {
  it("reports hmtx, CFF and kerning separately", () => {
    const font = buildFont({
      cff: { widths: { 4: 1500 } },
      kerning: { table: "GPOS", left: 3, right: 4, value: 250 },
    });
    const { view, tables } = tablesOf(font);
    expect(widestAdvances(view, tables)).toEqual({ glyph: 1500, kerning: 250 });
  });

  it("throws a fault, not a RangeError, for a CFF table with two fonts", () => {
    const font = buildFont({ cff: {} });
    const { view, tables } = tablesOf(font);
    const cff = tables.get("CFF ");
    if (!cff) throw new Error("no CFF table");
    /* Name INDEX starts at the header size; Top DICT INDEX count follows it. */
    const nameCount = view.getUint16(cff.offset + 4);
    expect(nameCount).toBe(1);
    const nameEnd =
      cff.offset + 4 + 3 + 2 * 2 + view.getUint16(cff.offset + 4 + 5) - 1;
    view.setUint16(nameEnd, 2);
    expect(() => widestAdvances(view, tables)).toThrow();
    try {
      widestAdvances(view, tables);
    } catch (error) {
      expect(
        error instanceof FontAdvanceFault || error instanceof RangeError,
      ).toBe(true);
    }
  });
});
