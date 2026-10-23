/**
 * The widest step satori can take across one glyph of a face, read from
 * every place its font parser takes an advance from.
 *
 * Satori loops when a word-breaking line is narrower than one grapheme
 * cluster, so the layer renderer keeps lines MAX_GLYPH_EM wide per code
 * point (document/render.tsx minBreakableWidth). That bound is only true if
 * no glyph a cluster can reach is wider, and a cluster can reach any glyph:
 * .notdef for a code point no face covers, a ligature through GSUB, a glyph
 * mapped from any plane. So every glyph is measured, not the ones a cmap
 * range is expected to hold.
 *
 * The parser bundled in next/og (opentype.js) takes a glyph's advance from
 * three places, all mirrored here:
 *  - hmtx, when the face is parsed;
 *  - for CFF outlines, the width operand of the glyph's charstring, which
 *    replaces the hmtx advance the first time the glyph is drawn and stays
 *    for every later measurement (the render worker keeps parsed faces);
 *  - pair kerning (GPOS PairPos, or the legacy kern table), added between
 *    two glyphs of the same cluster.
 */

interface TableRecord {
  offset: number;
  length: number;
}

export interface Advances {
  /** Widest advance any glyph can be given, in font units. */
  glyph: number;
  /** Largest positive kerning any glyph pair can be given, in font units. */
  kerning: number;
}

/* A program is read only until its width is settled, which in a real face
   is within its first few operators: a 17,944-glyph CID face settles every
   width in 245,000 operators (40ms). Subroutines can fan out (depth 10,
   each calling the next a thousand times) to hold the reader on one glyph,
   so reading stops here and the face is refused. */
const CHARSTRING_OPERATOR_BUDGET = 2_000_000;
const MAX_SUBR_DEPTH = 10;

export class FontAdvanceFault extends Error {}

/** hmtx holds numberOfHMetrics advances; every later glyph reuses the last,
 *  so the widest entry is the widest hmtx advance of any glyph. */
function hmtxWidest(
  view: DataView,
  hhea: TableRecord,
  hmtx: TableRecord,
): number {
  const metrics = view.getUint16(hhea.offset + 34);
  let widest = 0;
  for (let glyph = 0; glyph < metrics; glyph += 1) {
    widest = Math.max(widest, view.getUint16(hmtx.offset + glyph * 4));
  }
  return widest;
}

interface CffIndex {
  count: number;
  /** Absolute byte range of element i. */
  at(i: number): [number, number];
  end: number;
}

function cffIndex(view: DataView, start: number): CffIndex {
  const count = view.getUint16(start);
  if (count === 0) return { count, at: () => [start, start], end: start + 2 };
  const offSize = view.getUint8(start + 2);
  if (offSize < 1 || offSize > 4) {
    throw new FontAdvanceFault("a CFF index has an impossible offset size");
  }
  const offsets = start + 3;
  const offset = (i: number) => {
    let value = 0;
    for (let b = 0; b < offSize; b += 1) {
      value = value * 256 + view.getUint8(offsets + i * offSize + b);
    }
    return value;
  };
  const data = offsets + (count + 1) * offSize - 1;
  const end = data + offset(count);
  if (end > view.byteLength) {
    throw new FontAdvanceFault("a CFF index runs past the end of the file");
  }
  return { count, at: (i) => [data + offset(i), data + offset(i + 1)], end };
}

/** A CFF DICT as operator -> operands; two-byte operators are 1200 + b. */
function cffDict(view: DataView, from: number, to: number) {
  const dict = new Map<number, number[]>();
  let operands: number[] = [];
  let at = from;
  while (at < to) {
    const b0 = view.getUint8(at);
    at += 1;
    if (b0 <= 21) {
      const op = b0 === 12 ? 1200 + view.getUint8(at++) : b0;
      dict.set(op, operands);
      operands = [];
    } else if (b0 === 28) {
      operands.push(view.getInt16(at));
      at += 2;
    } else if (b0 === 29) {
      operands.push(view.getInt32(at));
      at += 4;
    } else if (b0 === 30) {
      operands.push(cffReal(view, at));
      let byte = view.getUint8(at++);
      while (byte >> 4 !== 0x0f && (byte & 0x0f) !== 0x0f) {
        byte = view.getUint8(at++);
      }
    } else if (b0 >= 32 && b0 <= 246) {
      operands.push(b0 - 139);
    } else if (b0 >= 247 && b0 <= 250) {
      operands.push((b0 - 247) * 256 + view.getUint8(at++) + 108);
    } else if (b0 >= 251 && b0 <= 254) {
      operands.push(-(b0 - 251) * 256 - view.getUint8(at++) - 108);
    }
  }
  return dict;
}

function cffReal(view: DataView, at: number): number {
  const nibbles = "0123456789.EE?-";
  let text = "";
  for (let i = at; ; i += 1) {
    const byte = view.getUint8(i);
    for (const nibble of [byte >> 4, byte & 0x0f]) {
      if (nibble === 0x0f) return Number.parseFloat(text) || 0;
      text += nibble === 0x0c ? "E-" : nibbles[nibble];
    }
  }
}

function subrBias(count: number): number {
  return count < 1240 ? 107 : count < 33900 ? 1131 : 32768;
}

interface PrivateScope {
  defaultWidthX: number;
  nominalWidthX: number;
  subrs: CffIndex | null;
}

/** The Private DICT a Top or Font DICT points at, read as opentype.js reads
 *  it: absent unless both its size and offset are non-zero. */
function privateScope(
  view: DataView,
  cff: number,
  dict: Map<number, number[]>,
): PrivateScope {
  const [size = 0, offset = 0] = dict.get(18) ?? [];
  if (size === 0 || offset === 0) {
    return { defaultWidthX: 0, nominalWidthX: 0, subrs: null };
  }
  const start = cff + offset;
  const priv = cffDict(view, start, start + size);
  const subrsOffset = priv.get(19)?.[0] ?? 0;
  return {
    defaultWidthX: priv.get(20)?.[0] ?? 0,
    nominalWidthX: priv.get(21)?.[0] ?? 0,
    subrs: subrsOffset === 0 ? null : cffIndex(view, start + subrsOffset),
  };
}

function fdSelect(
  view: DataView,
  at: number,
  glyphs: number,
  fds: number,
): (glyph: number) => number {
  const format = view.getUint8(at);
  const byGlyph = new Uint8Array(glyphs);
  if (format === 0) {
    for (let g = 0; g < glyphs; g += 1) byGlyph[g] = view.getUint8(at + 1 + g);
  } else if (format === 3) {
    const ranges = view.getUint16(at + 1);
    for (let r = 0; r < ranges; r += 1) {
      const range = at + 3 + r * 3;
      const first = view.getUint16(range);
      const next = view.getUint16(range + 3);
      const fd = view.getUint8(range + 2);
      for (let g = first; g < Math.min(next, glyphs); g += 1) byGlyph[g] = fd;
    }
  } else {
    throw new FontAdvanceFault(
      "its CFF font select table has an unknown format",
    );
  }
  if (byGlyph.some((fd) => fd >= fds)) {
    throw new FontAdvanceFault(
      "its CFF font select table names a missing font",
    );
  }
  return (glyph) => byGlyph[glyph];
}

/**
 * The width opentype.js gives a CFF glyph once it is drawn: defaultWidthX,
 * or nominalWidthX plus the operand left over at the first stem or moveto.
 *
 * Operator by operator a copy of opentype.js's parseCFFCharstring with the
 * outline arithmetic left out: which operand counts as the width depends on
 * exactly how many each earlier operator consumed, flex operators included,
 * and a looser reading would let a hostile face hide a width it would draw.
 */
function charstringWidth(
  view: DataView,
  [from, to]: [number, number],
  scope: PrivateScope,
  globals: CffIndex,
  budget: { left: number },
): number {
  const stack: number[] = [];
  let width = scope.defaultWidthX;
  let haveWidth = false;
  let stems = 0;
  const takeWidth = () => {
    width = (stack.shift() ?? Number.NaN) + scope.nominalWidthX;
    haveWidth = true;
  };
  const parseStems = () => {
    if (stack.length % 2 !== 0 && !haveWidth) takeWidth();
    stems += stack.length >> 1;
    stack.length = 0;
    haveWidth = true;
  };
  const shift = (n: number) => {
    stack.splice(0, n);
  };
  /* True once the width is settled: opentype.js never changes it after. */
  const run = (start: number, end: number, depth: number): boolean => {
    /* Past its end a program reads undefined in opentype.js, so the
       operand is NaN, never a byte of whatever follows it. */
    const byte = (at: number) => (at < end ? view.getUint8(at) : Number.NaN);
    if (depth > MAX_SUBR_DEPTH) {
      throw new FontAdvanceFault("its outlines call each other too deeply");
    }
    let i = start;
    while (i < end) {
      budget.left -= 1;
      if (budget.left < 0) {
        throw new FontAdvanceFault("its outlines take too long to read");
      }
      const v = view.getUint8(i);
      i += 1;
      switch (v) {
        case 1:
        case 3:
        case 18:
        case 23:
          parseStems();
          break;
        case 19:
        case 20:
          parseStems();
          i += (stems + 7) >> 3;
          break;
        case 4:
        case 22:
          if (stack.length > 1 && !haveWidth) takeWidth();
          stack.pop();
          break;
        case 21:
          if (stack.length > 2 && !haveWidth) takeWidth();
          stack.pop();
          stack.pop();
          break;
        case 14:
          if (stack.length > 0 && !haveWidth) takeWidth();
          break;
        case 5:
        case 6:
        case 7:
        case 8:
        case 24:
        case 25:
        case 26:
        case 27:
        case 30:
        case 31:
          stack.length = 0;
          break;
        case 10:
        case 29: {
          const subrs = v === 10 ? scope.subrs : globals;
          const index =
            (stack.pop() ?? Number.NaN) + subrBias(subrs?.count ?? 0);
          if (
            subrs &&
            Number.isInteger(index) &&
            index >= 0 &&
            index < subrs.count
          ) {
            if (run(...subrs.at(index), depth + 1)) return true;
          }
          break;
        }
        case 11:
          return haveWidth;
        case 12: {
          const flex = i < end ? view.getUint8(i) : -1;
          i += 1;
          if (flex === 35) shift(13);
          else if (flex === 34) shift(7);
          else if (flex === 36) shift(9);
          else if (flex === 37) shift(11);
          else stack.length = 0;
          break;
        }
        case 28:
          stack.push(((byte(i) << 24) | (byte(i + 1) << 16)) >> 16);
          i += 2;
          break;
        default:
          if (v < 32) break;
          if (v < 247) stack.push(v - 139);
          else if (v < 251) {
            stack.push((v - 247) * 256 + byte(i) + 108);
            i += 1;
          } else if (v < 255) {
            stack.push(-(v - 251) * 256 - byte(i) - 108);
            i += 1;
          } else {
            stack.push(
              ((byte(i) << 24) |
                (byte(i + 1) << 16) |
                (byte(i + 2) << 8) |
                byte(i + 3)) /
                65536,
            );
            i += 4;
          }
      }
      if (haveWidth) return true;
    }
    return false;
  };
  run(from, to, 0);
  return Number.isFinite(width) ? width : 0;
}

/** Each glyph's drawn CFF width, by glyph id. */
export function cffWidths(view: DataView, cff: TableRecord): Float64Array {
  const start = cff.offset;
  const headerSize = view.getUint8(start + 2);
  const names = cffIndex(view, start + headerSize);
  const tops = cffIndex(view, names.end);
  if (tops.count !== 1) {
    throw new FontAdvanceFault("its CFF table holds more than one font");
  }
  const strings = cffIndex(view, tops.end);
  const globals = cffIndex(view, strings.end);
  const top = cffDict(view, ...tops.at(0));
  const charStringsOffset = top.get(17)?.[0];
  if (charStringsOffset === undefined) {
    throw new FontAdvanceFault("its CFF table has no glyph programs");
  }
  const charStrings = cffIndex(view, start + charStringsOffset);

  let scopeOf: (glyph: number) => PrivateScope;
  const ros = top.get(1230);
  if (ros && ros.length >= 2) {
    const fdArray = top.get(1236)?.[0] ?? 0;
    const fdSelectAt = top.get(1237)?.[0] ?? 0;
    if (fdArray === 0 || fdSelectAt === 0) {
      throw new FontAdvanceFault("its CID font has no font select table");
    }
    const fonts = cffIndex(view, start + fdArray);
    const scopes = Array.from({ length: fonts.count }, (_, i) =>
      privateScope(view, start, cffDict(view, ...fonts.at(i))),
    );
    const fdOf = fdSelect(
      view,
      start + fdSelectAt,
      charStrings.count,
      fonts.count,
    );
    scopeOf = (glyph) => scopes[fdOf(glyph)];
  } else {
    const scope = privateScope(view, start, top);
    scopeOf = () => scope;
  }

  const budget = { left: CHARSTRING_OPERATOR_BUDGET };
  const widths = new Float64Array(charStrings.count);
  for (let glyph = 0; glyph < charStrings.count; glyph += 1) {
    widths[glyph] = charstringWidth(
      view,
      charStrings.at(glyph),
      scopeOf(glyph),
      globals,
      budget,
    );
  }
  return widths;
}

const popcount = (n: number) => {
  let bits = 0;
  for (let v = n; v; v >>= 1) bits += v & 1;
  return bits;
};

/** Largest XAdvance on the first glyph of any pair, in any PairPos lookup.
 *  Every lookup, not only those a 'kern' feature names for the default
 *  script: which feature opentype.js picks is its business, the bound has
 *  to hold whichever it is. */
function gposWidest(view: DataView, gpos: TableRecord): number {
  const end = view.byteLength;
  const lookupList = gpos.offset + view.getUint16(gpos.offset + 8);
  const lookups = view.getUint16(lookupList);
  let widest = 0;
  for (let l = 0; l < lookups; l += 1) {
    const lookup = lookupList + view.getUint16(lookupList + 2 + l * 2);
    const type = view.getUint16(lookup);
    const subtables = view.getUint16(lookup + 4);
    for (let s = 0; s < subtables; s += 1) {
      let subtable = lookup + view.getUint16(lookup + 6 + s * 2);
      let subtableType = type;
      if (type === 9) {
        subtableType = view.getUint16(subtable + 2);
        subtable += view.getUint32(subtable + 4);
      }
      if (subtableType !== 2) continue;
      widest = Math.max(widest, pairPosWidest(view, subtable, end));
    }
  }
  return widest;
}

function pairPosWidest(view: DataView, at: number, end: number): number {
  const format = view.getUint16(at);
  const format1 = view.getUint16(at + 4);
  const format2 = view.getUint16(at + 6);
  if (!(format1 & 0x0004)) return 0;
  const xAdvanceAt = 2 * popcount(format1 & 0x0003);
  const pairBytes = 2 * popcount(format1) + 2 * popcount(format2);
  let widest = 0;
  /* Bounded by the file, not the table: opentype.js reads a record wherever
     its offsets point, and past the end of the file it throws instead. */
  const readRecords = (
    first: number,
    count: number,
    stride: number,
    xAdvance: number,
  ) => {
    const last = Math.min(count, Math.floor((end - first) / stride));
    for (let r = 0; r < last; r += 1) {
      widest = Math.max(widest, view.getInt16(first + r * stride + xAdvance));
    }
  };
  if (format === 1) {
    const sets = view.getUint16(at + 8);
    for (let p = 0; p < sets; p += 1) {
      const set = at + view.getUint16(at + 10 + p * 2);
      /* secondGlyph leads each PairValueRecord. */
      readRecords(set + 2, view.getUint16(set), 2 + pairBytes, 2 + xAdvanceAt);
    }
  } else if (format === 2) {
    const records = view.getUint16(at + 12) * view.getUint16(at + 14);
    readRecords(at + 16, records, pairBytes, xAdvanceAt);
  }
  return widest;
}

/** Version 0 (OpenType) and version 1 (Apple) kern tables, format 0 pairs. */
function kernWidest(view: DataView, kern: TableRecord): number {
  const end = view.byteLength;
  const apple = view.getUint16(kern.offset) === 1;
  const tables = apple
    ? view.getUint32(kern.offset + 4)
    : view.getUint16(kern.offset + 2);
  let at = kern.offset + (apple ? 8 : 4);
  let widest = 0;
  for (let t = 0; t < tables && at + 14 <= end; t += 1) {
    const length = apple ? view.getUint32(at) : view.getUint16(at + 2);
    const format = apple ? view.getUint8(at + 5) : view.getUint8(at + 4);
    const header = apple ? 8 : 6;
    if (format === 0) {
      const pairs = view.getUint16(at + header);
      const first = at + header + 8;
      const last = Math.min(pairs, Math.floor((end - first) / 6));
      for (let p = 0; p < last; p += 1) {
        widest = Math.max(widest, view.getInt16(first + p * 6 + 4));
      }
    }
    if (length === 0) break;
    at += length;
  }
  return widest;
}

export function widestAdvances(
  view: DataView,
  tables: Map<string, TableRecord>,
): Advances {
  const hhea = tables.get("hhea");
  const hmtx = tables.get("hmtx");
  if (!hhea || !hmtx) throw new FontAdvanceFault("it has no glyph metrics");
  const cff = tables.get("CFF ");
  const gpos = tables.get("GPOS");
  const kern = tables.get("kern");
  return {
    glyph: Math.max(
      hmtxWidest(view, hhea, hmtx),
      cff ? cffWidths(view, cff).reduce((a, b) => Math.max(a, b), 0) : 0,
    ),
    kerning: Math.max(
      gpos ? gposWidest(view, gpos) : 0,
      kern ? kernWidest(view, kern) : 0,
    ),
  };
}
