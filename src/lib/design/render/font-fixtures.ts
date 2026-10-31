/**
 * Font fixtures built at runtime.
 *
 * The Safety rule forbids committing binaries, and a corrupt font checked into
 * the repo is exactly that — plus nobody could tell from review which byte was
 * meant to be wrong. So every fixture here is assembled from named fields, and
 * each corrupt variant is one declared deviation from a valid file.
 *
 * `buildFont()` with no arguments is not merely "structurally valid": satori
 * really renders it. That is load-bearing. A fixture whose cmap satori cannot
 * read (format 0 and format 6 are both refused — only 4 and 12 are supported)
 * would turn every "a valid font is accepted" assertion in the suite into an
 * assertion about a font the renderer would reject anyway.
 *
 * Test-only, but not in a .test.ts file: fonts.test.ts, font-file.test.ts and
 * the upload route test all need them.
 */

/** Which single thing is wrong. Everything left at its default is correct. */
export interface FontShape {
  /** The four opening bytes. Defaults to TrueType's 0x00010000. */
  signature?: number[];
  numGlyphs?: number;
  unitsPerEm?: number;
  /** Every glyph's advance, in font units. */
  advance?: number;
  /** One glyph's hmtx advance, by glyph id (0 is .notdef). */
  advances?: Record<number, number>;
  /** CFF outlines in place of glyf/loca, each charstring carrying a width
   *  operand. Widths not listed match hmtx. */
  cff?: {
    defaultWidthX?: number;
    nominalWidthX?: number;
    /** Drawn widths, by glyph id; null leaves the operand out, so the glyph
     *  draws at defaultWidthX. */
    widths?: Record<number, number | null>;
    /** Local subroutines, raw Type 2 bytes. */
    subrs?: number[][];
  };
  /** One kerning pair, by glyph id, in a GPOS 'kern' lookup or a kern table. */
  kerning?: {
    table: "GPOS" | "kern";
    left: number;
    right: number;
    value: number;
  };
  headMagic?: number;
  indexToLocFormat?: number;
  numberOfHMetrics?: number;
  cmapEncodings?: number;
  /** Tables to leave out of the directory entirely. */
  omit?: string[];
  /** A table count the directory does not actually contain. */
  declaredNumTables?: number;
  /** Point the last loca entry past the end of glyf. */
  locaOvershoot?: boolean;
  /** Cut the finished file to this many bytes. */
  truncateTo?: number;
}

const TRUETYPE = [0x00, 0x01, 0x00, 0x00];
const OPENTYPE_CFF = [0x4f, 0x54, 0x54, 0x4f];
const HEAD_MAGIC = 0x5f0f3cf5;

/* One glyph per printable ASCII character plus .notdef, so the cmap below can
   map a whole contiguous range with a single segment and no glyph index array.
   Outlines are empty apart from the one below, which is a legal glyph — the
   fixture exists to be parsed, measured and drawn, not to be legible. */
const FIRST_CHAR = 0x20;
const LAST_CHAR = 0x7e;
const GLYPH_COUNT = LAST_CHAR - FIRST_CHAR + 2;

function table(size: number): DataView {
  return new DataView(new ArrayBuffer(size));
}

/**
 * One filled rectangle, as a TrueType simple glyph.
 *
 * Present so "satori renders this fixture" means ink on the canvas rather than
 * a blank frame: a font of nothing but empty outlines would still produce a
 * PNG, which would prove parsing and hide a renderer that draws nothing.
 */
function rectangleGlyph(): Uint8Array {
  const t = table(34);
  t.setInt16(0, 1); // one contour
  t.setInt16(2, 0); // xMin
  t.setInt16(4, 0); // yMin
  t.setInt16(6, 500); // xMax
  t.setInt16(8, 700); // yMax
  t.setUint16(10, 3); // last point of the contour
  t.setUint16(12, 0); // no hinting instructions
  for (let i = 0; i < 4; i++) t.setUint8(14 + i, 0x01); // on-curve, long deltas
  [0, 500, 0, -500].forEach((dx, i) => {
    t.setInt16(18 + i * 2, dx);
  });
  [0, 0, 700, 0].forEach((dy, i) => {
    t.setInt16(26 + i * 2, dy);
  });
  return new Uint8Array(t.buffer);
}

const GLYF = rectangleGlyph();
/** The glyph the cmap segment below maps "A" to. */
export const OUTLINE_GLYPH = 0x41 - FIRST_CHAR + 1;

function head(shape: FontShape): Uint8Array {
  const t = table(54);
  t.setUint16(0, 1);
  t.setUint32(4, 0x00010000);
  t.setUint32(12, shape.headMagic ?? HEAD_MAGIC);
  t.setUint16(18, shape.unitsPerEm ?? 1000);
  t.setInt16(36, FIRST_CHAR);
  t.setInt16(50, shape.indexToLocFormat ?? 0);
  return new Uint8Array(t.buffer);
}

function hhea(shape: FontShape, numGlyphs: number): Uint8Array {
  const t = table(36);
  t.setUint32(0, 0x00010000);
  t.setInt16(4, 800); // ascender
  t.setInt16(6, -200); // descender
  t.setInt16(10, 600); // advanceWidthMax
  t.setUint16(34, shape.numberOfHMetrics ?? numGlyphs);
  return new Uint8Array(t.buffer);
}

function maxp(numGlyphs: number, cff: boolean): Uint8Array {
  const t = table(cff ? 6 : 32);
  t.setUint32(0, cff ? 0x00005000 : 0x00010000);
  t.setUint16(4, numGlyphs);
  return new Uint8Array(t.buffer);
}

function hmtx(
  numGlyphs: number,
  advance = 500,
  advances: Record<number, number> = {},
): Uint8Array {
  const t = table(numGlyphs * 4);
  for (let i = 0; i < numGlyphs; i++) {
    t.setUint16(i * 4, advances[i] ?? advance);
  }
  return new Uint8Array(t.buffer);
}

function concat(parts: (Uint8Array | number[])[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A CFF INDEX of the given elements, with 2-byte offsets. */
function cffIndex(elements: Uint8Array[]): Uint8Array {
  if (elements.length === 0) return new Uint8Array([0, 0]);
  const header = table(3 + (elements.length + 1) * 2);
  header.setUint16(0, elements.length);
  header.setUint8(2, 2);
  let offset = 1;
  elements.forEach((element, i) => {
    header.setUint16(3 + i * 2, offset);
    offset += element.length;
  });
  header.setUint16(3 + elements.length * 2, offset);
  return concat([new Uint8Array(header.buffer), ...elements]);
}

/** A DICT operand in the five-byte form, so offsets can be patched in
 *  without moving anything. */
function dictInt(value: number): number[] {
  const t = table(5);
  t.setUint8(0, 29);
  t.setInt32(1, value);
  return [...new Uint8Array(t.buffer)];
}

function charstringInt(value: number): number[] {
  const t = table(3);
  t.setUint8(0, 28);
  t.setInt16(1, value);
  return [...new Uint8Array(t.buffer)];
}

const ENDCHAR = 14;
const RMOVETO = 21;
const HLINETO = 6;
const VLINETO = 7;

/** A non-CID CFF table: one charstring per glyph, the outline glyph a
 *  filled rectangle like its glyf counterpart. */
function cffTable(
  shape: FontShape,
  numGlyphs: number,
  options: NonNullable<FontShape["cff"]>,
): Uint8Array {
  const defaultWidthX = options.defaultWidthX ?? 0;
  const nominalWidthX = options.nominalWidthX ?? 0;
  const charstrings = Array.from({ length: numGlyphs }, (_, glyph) => {
    const width =
      glyph in (options.widths ?? {})
        ? options.widths?.[glyph]
        : (shape.advances?.[glyph] ?? shape.advance ?? 500);
    const operand =
      width === null || width === undefined
        ? []
        : charstringInt(width - nominalWidthX);
    const outline =
      glyph === OUTLINE_GLYPH
        ? [
            ...operand,
            ...charstringInt(0),
            ...charstringInt(0),
            RMOVETO,
            ...charstringInt(500),
            HLINETO,
            ...charstringInt(700),
            VLINETO,
            ...charstringInt(-500),
            HLINETO,
            ENDCHAR,
          ]
        : [...operand, ENDCHAR];
    return new Uint8Array(outline);
  });

  const header = new Uint8Array([1, 0, 4, 4]);
  const names = cffIndex([new TextEncoder().encode("KOOSFixture")]);
  const subrs = options.subrs?.length
    ? cffIndex(options.subrs.map((subr) => new Uint8Array(subr)))
    : null;
  const privateBytes = 12 + (subrs ? 6 : 0);
  /* Subrs are placed right after the Private DICT, at an offset relative
     to its start. */
  const privateDict = new Uint8Array([
    ...dictInt(defaultWidthX),
    20,
    ...dictInt(nominalWidthX),
    21,
    ...(subrs ? [...dictInt(privateBytes), 19] : []),
  ]);
  /* SIDs 1..n-1 are standard glyph names, so no String INDEX is needed. */
  const charset = new Uint8Array(1 + (numGlyphs - 1) * 2);
  for (let glyph = 1; glyph < numGlyphs; glyph += 1) {
    charset[glyph * 2 - 1] = 0;
    charset[glyph * 2] = glyph & 0xff;
  }
  const charStringIndex = cffIndex(charstrings);
  const topDictBytes = 3 * 6 + 5;
  const topIndexBytes = 3 + 2 * 2 + topDictBytes;
  const strings = cffIndex([]);
  const globals = cffIndex([]);
  const charsetAt =
    header.length +
    names.length +
    topIndexBytes +
    strings.length +
    globals.length;
  const charStringsAt = charsetAt + charset.length;
  const privateAt = charStringsAt + charStringIndex.length;
  const topDict = new Uint8Array([
    ...dictInt(charsetAt),
    15,
    ...dictInt(charStringsAt),
    17,
    ...dictInt(privateDict.length),
    ...dictInt(privateAt),
    18,
  ]);
  return concat([
    header,
    names,
    cffIndex([topDict]),
    strings,
    globals,
    charset,
    charStringIndex,
    privateDict,
    ...(subrs ? [subrs] : []),
  ]);
}

/** DFLT script -> 'kern' feature -> one PairPos format 1 lookup holding a
 *  single pair, which is the path opentype.js reads kerning from. */
function gposTable(left: number, right: number, value: number): Uint8Array {
  const t = table(80);
  t.setUint32(0, 0x00010000);
  t.setUint16(4, 10); // ScriptList
  t.setUint16(6, 30); // FeatureList
  t.setUint16(8, 44); // LookupList
  // ScriptList at 10: one record, DFLT -> Script at +8
  t.setUint16(10, 1);
  t.setUint32(12, 0x44464c54);
  t.setUint16(16, 8);
  // Script at 18: default LangSys at +4, no others
  t.setUint16(18, 4);
  t.setUint16(20, 0);
  // LangSys at 22
  t.setUint16(22, 0);
  t.setUint16(24, 0xffff);
  t.setUint16(26, 1);
  t.setUint16(28, 0);
  // FeatureList at 30: one record, 'kern' -> Feature at +8
  t.setUint16(30, 1);
  t.setUint32(32, 0x6b65726e);
  t.setUint16(36, 8);
  // Feature at 38
  t.setUint16(38, 0);
  t.setUint16(40, 1);
  t.setUint16(42, 0);
  // LookupList at 44: one lookup at +4
  t.setUint16(44, 1);
  t.setUint16(46, 4);
  // Lookup at 48: PairPos, one subtable at +8
  t.setUint16(48, 2);
  t.setUint16(50, 0);
  t.setUint16(52, 1);
  t.setUint16(54, 8);
  // PairPos format 1 at 56: coverage at +12, value1 = XAdvance
  t.setUint16(56, 1);
  t.setUint16(58, 12);
  t.setUint16(60, 0x0004);
  t.setUint16(62, 0);
  t.setUint16(64, 1);
  t.setUint16(66, 18);
  // Coverage format 1 at 68
  t.setUint16(68, 1);
  t.setUint16(70, 1);
  t.setUint16(72, left);
  // PairSet at 74: one record
  t.setUint16(74, 1);
  t.setUint16(76, right);
  t.setInt16(78, value);
  return new Uint8Array(t.buffer);
}

/** Version 0 kern table, one format 0 subtable with one pair. */
function kernTable(left: number, right: number, value: number): Uint8Array {
  const t = table(4 + 6 + 8 + 6);
  t.setUint16(0, 0);
  t.setUint16(2, 1);
  t.setUint16(4, 0);
  t.setUint16(6, 6 + 8 + 6);
  t.setUint16(8, 0x0001); // horizontal, format 0
  t.setUint16(10, 1);
  t.setUint16(18, left);
  t.setUint16(20, right);
  t.setInt16(22, value);
  return new Uint8Array(t.buffer);
}

/**
 * One format-4 subtable covering printable ASCII.
 *
 * Format 4 rather than the shorter format 0 or 6 because those are the two
 * shapes satori refuses outright ("Only format 4 and 12 cmap tables are
 * supported"), and a fixture the renderer refuses proves nothing.
 */
function cmap(shape: FontShape): Uint8Array {
  const encodings = shape.cmapEncodings ?? 1;
  const headerBytes = 4 + encodings * 8;
  const SUBTABLE_BYTES = 32;
  const t = table(headerBytes + SUBTABLE_BYTES);
  t.setUint16(2, encodings);
  for (let i = 0; i < encodings; i++) {
    t.setUint16(4 + i * 8, 3); // Windows
    t.setUint16(6 + i * 8, 1); // Unicode BMP
    t.setUint32(8 + i * 8, headerBytes);
  }
  const at = headerBytes;
  t.setUint16(at, 4);
  t.setUint16(at + 2, SUBTABLE_BYTES);
  t.setUint16(at + 6, 4); // segCountX2, i.e. two segments
  t.setUint16(at + 8, 4); // searchRange
  t.setUint16(at + 10, 1); // entrySelector
  t.setUint16(at + 12, 0); // rangeShift
  t.setUint16(at + 14, LAST_CHAR); // endCode[0]
  t.setUint16(at + 16, 0xffff); // endCode[1], the required terminator
  t.setUint16(at + 20, FIRST_CHAR); // startCode[0]
  t.setUint16(at + 22, 0xffff); // startCode[1]
  /* glyphIndex = (charCode + idDelta) & 0xffff, so this maps FIRST_CHAR to
     glyph 1 and every later character to the next glyph in order. */
  t.setInt16(at + 24, 1 - FIRST_CHAR);
  t.setInt16(at + 26, 1);
  return new Uint8Array(t.buffer);
}

/** Short-format offsets, in words. Every glyph before the drawn one is empty,
 *  every glyph after it ends where the glyf table does. */
function loca(shape: FontShape, numGlyphs: number): Uint8Array {
  const t = table((numGlyphs + 1) * 2);
  for (let i = 0; i <= numGlyphs; i++) {
    t.setUint16(i * 2, i <= OUTLINE_GLYPH ? 0 : GLYF.length / 2);
  }
  if (shape.locaOvershoot) t.setUint16(numGlyphs * 2, GLYF.length);
  return new Uint8Array(t.buffer);
}

/** Minimal but real: opentype parsers read the name table for the family, and
 *  a missing one is a different failure from the one under test. */
function name(): Uint8Array {
  const value = "KOOS Fixture";
  const records = 1;
  const headerBytes = 6 + records * 12;
  const t = table(headerBytes + value.length);
  t.setUint16(0, 0);
  t.setUint16(2, records);
  t.setUint16(4, headerBytes);
  t.setUint16(6, 3); // Windows
  t.setUint16(8, 1); // Unicode BMP
  t.setUint16(10, 0x0409); // en-US
  t.setUint16(12, 1); // family name
  t.setUint16(14, value.length);
  t.setUint16(16, 0);
  const bytes = new Uint8Array(t.buffer);
  for (let i = 0; i < value.length; i++) {
    bytes[headerBytes + i] = value.charCodeAt(i);
  }
  return bytes;
}

function os2(): Uint8Array {
  const t = table(78);
  t.setUint16(0, 1); // version
  t.setUint16(2, 500); // xAvgCharWidth
  t.setUint16(4, 400); // usWeightClass
  t.setUint16(6, 5); // usWidthClass
  t.setUint16(64, FIRST_CHAR); // usFirstCharIndex
  t.setUint16(66, LAST_CHAR); // usLastCharIndex
  t.setInt16(68, 800); // sTypoAscender
  t.setInt16(70, -200); // sTypoDescender
  t.setUint16(74, 800); // usWinAscent
  t.setUint16(76, 200); // usWinDescent
  return new Uint8Array(t.buffer);
}

function post(): Uint8Array {
  const t = table(32);
  t.setUint32(0, 0x00030000); // version 3: no glyph names
  return new Uint8Array(t.buffer);
}

function padTo4(n: number): number {
  return (4 - (n % 4)) % 4;
}

/** A structurally valid, genuinely renderable sfnt — or the same file with one
 *  field spoiled. */
export function buildFont(shape: FontShape = {}): Uint8Array {
  const numGlyphs = shape.numGlyphs ?? GLYPH_COUNT;
  const omit = new Set(shape.omit ?? []);
  const outlines: [string, Uint8Array][] = shape.cff
    ? [["CFF ", cffTable(shape, numGlyphs, shape.cff)]]
    : [
        ["glyf", GLYF],
        ["loca", loca(shape, numGlyphs)],
      ];
  const kerning: [string, Uint8Array][] = shape.kerning
    ? [
        [
          shape.kerning.table,
          (shape.kerning.table === "GPOS" ? gposTable : kernTable)(
            shape.kerning.left,
            shape.kerning.right,
            shape.kerning.value,
          ),
        ],
      ]
    : [];
  const parts: [string, Uint8Array][] = (
    [
      ["OS/2", os2()],
      ["cmap", cmap(shape)],
      ["head", head(shape)],
      ["hhea", hhea(shape, numGlyphs)],
      ["hmtx", hmtx(Math.max(numGlyphs, 1), shape.advance, shape.advances)],
      ["maxp", maxp(numGlyphs, Boolean(shape.cff))],
      ["name", name()],
      ["post", post()],
      ...outlines,
      ...kerning,
    ] as [string, Uint8Array][]
  )
    .filter(([tag]) => !omit.has(tag))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const directoryBytes = 12 + parts.length * 16;
  let cursor = directoryBytes + padTo4(directoryBytes);
  const placed = parts.map(([tag, bytes]) => {
    const at = cursor;
    cursor += bytes.length + padTo4(bytes.length);
    return { tag, bytes, offset: at };
  });

  const file = new Uint8Array(cursor);
  const view = new DataView(file.buffer);
  file.set(shape.signature ?? (shape.cff ? OPENTYPE_CFF : TRUETYPE), 0);
  view.setUint16(4, shape.declaredNumTables ?? parts.length);
  placed.forEach((entry, i) => {
    const at = 12 + i * 16;
    for (let c = 0; c < 4; c++) file[at + c] = entry.tag.charCodeAt(c);
    view.setUint32(at + 8, entry.offset);
    view.setUint32(at + 12, entry.bytes.length);
    file.set(entry.bytes, entry.offset);
  });

  return shape.truncateTo === undefined
    ? file
    : file.slice(0, shape.truncateTo);
}

/**
 * The production repro: a valid signature followed by nothing but zeros.
 * Passes every four-byte check and throws inside the renderer.
 */
export function signatureOnlyFont(byteLength = 211): Uint8Array {
  const file = new Uint8Array(byteLength);
  file.set(TRUETYPE, 0);
  return file;
}

/** What a browser upload cut off partway through leaves behind: an intact
 *  directory whose records point into bytes that never arrived. */
export function truncatedFont(fraction = 0.5): Uint8Array {
  const whole = buildFont();
  return whole.slice(0, Math.floor(whole.length * fraction));
}

/** A collection header pointing at a font that is not there. */
export function collectionWithBadOffset(): Uint8Array {
  const file = new Uint8Array(64);
  const view = new DataView(file.buffer);
  file.set([0x74, 0x74, 0x63, 0x66], 0);
  view.setUint16(4, 1);
  view.setUint32(8, 1);
  view.setUint32(12, 0xffff);
  return file;
}

/** Every way a signature-valid file can still be unrenderable, named. Each
 *  entry is one deviation, so a failure says which check stopped catching. */
export const CORRUPT_FONTS: { label: string; bytes: Uint8Array }[] = [
  { label: "a signature and nothing else", bytes: signatureOnlyFont() },
  {
    label: "a header cut off mid-directory",
    bytes: buildFont({ truncateTo: 40 }),
  },
  { label: "a half-finished upload", bytes: truncatedFont() },
  { label: "a file missing only its last table", bytes: truncatedFont(0.97) },
  {
    label: "a directory claiming tables it lacks",
    bytes: buildFont({ declaredNumTables: 0xffff }),
  },
  {
    label: "a head table that is not a font header",
    bytes: buildFont({ headMagic: 0 }),
  },
  { label: "an impossible em size", bytes: buildFont({ unitsPerEm: 0 }) },
  {
    label: "an unknown glyph index format",
    bytes: buildFont({ indexToLocFormat: 7 }),
  },
  { label: "no character map", bytes: buildFont({ omit: ["cmap"] }) },
  { label: "no glyph outlines", bytes: buildFont({ omit: ["glyf", "loca"] }) },
  { label: "no glyphs", bytes: buildFont({ numGlyphs: 0 }) },
  {
    label: "metrics for glyphs it does not have",
    bytes: buildFont({ numberOfHMetrics: 9999 }),
  },
  {
    label: "a glyph index pointing past its glyph data",
    bytes: buildFont({ locaOvershoot: true }),
  },
  { label: "an empty character map", bytes: buildFont({ cmapEncodings: 0 }) },
  { label: "a collection pointing nowhere", bytes: collectionWithBadOffset() },
];
