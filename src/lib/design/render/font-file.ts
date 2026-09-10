/**
 * What a font file is, and whether a renderer can open it.
 *
 * One module because there is one question. The four-byte signature says only
 * that a file *claims* to be a font; satori parses lazily, inside
 * `ImageResponse.arrayBuffer()`, so a file with a valid signature and a
 * shredded body surfaces as "RangeError: Offset is outside the bounds of the
 * DataView" halfway through a design render — after the upload has been
 * accepted and written to the brand, which makes every later render for that
 * brand fail identically (KOS-V1-BUG-018).
 *
 * The signature table lives here rather than in the upload route and the
 * renderer separately: two copies of the accepted formats is how `.ttc` came to
 * be accepted in one place and refused in the other.
 *
 * Hand-written rather than delegated to a font library: the only parser in the
 * bundle is the one inside next/og, which is not exported, and trial-rendering
 * every file is a full satori + resvg pass. This reads header fields only, so
 * it is O(number of tables) and allocates nothing but the table index. It is
 * necessary but NOT sufficient — a structurally perfect font can still defeat
 * satori (an unsupported GSUB lookup, a variable-font axis table), which is why
 * `font-probe.ts` exists at upload time and `composite.ts` retries at render
 * time.
 */

export type FontCheck = { ok: true } | { ok: false; reason: string };

interface TableRecord {
  offset: number;
  length: number;
}

/**
 * The containers satori can parse, by their opening four bytes.
 *
 * TrueType collections are deliberately absent. Satori refuses every one with
 * "Unsupported OpenType signature ttcf" — measured against 8 real `.ttc` files,
 * 8 refusals — so accepting one stores a file that can only ever fail at render
 * time. WOFF and WOFF2 are absent for the same reason.
 */
const SIGNATURES = new Map<number, string>([
  [0x00010000, "ttf"],
  [0x74727565, "ttf"], // "true"
  [0x4f54544f, "otf"], // "OTTO"
]);

const TTC_TAG = 0x74746366; // "ttcf"

const SFNT_HEADER_BYTES = 12;
const TABLE_RECORD_BYTES = 16;
const HEAD_MAGIC = 0x5f0f3cf5;
const HEAD_MIN_BYTES = 54;
const HHEA_MIN_BYTES = 36;
const MAXP_MIN_BYTES = 6;
const MIN_UNITS_PER_EM = 16;
const MAX_UNITS_PER_EM = 16384;

const NOT_A_FONT = "it is not a TTF or OTF font file";
const IS_A_COLLECTION =
  "it is a TrueType collection (.ttc), which the design renderer cannot open — export a single face as TTF or OTF";

function fail(reason: string): FontCheck {
  return { ok: false, reason };
}

function viewOf(bytes: Uint8Array): DataView {
  /* Offset and length passed explicitly: getObjectBytes hands back a Buffer,
     which is a view into a shared pool — a DataView built on .buffer alone
     reads someone else's bytes. */
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function signatureOf(bytes: Uint8Array): number | null {
  return bytes.byteLength < 4 ? null : viewOf(bytes).getUint32(0);
}

/** TrueType or CFF OpenType — what satori can parse. */
export function isRenderableFont(bytes: Uint8Array): boolean {
  const signature = signatureOf(bytes);
  return signature !== null && SIGNATURES.has(signature);
}

/** The extension a font is stored under, taken from its bytes rather than its
 *  client-supplied MIME type. Null for anything that is not a font. */
export function fontExtension(bytes: Uint8Array): string | null {
  const signature = signatureOf(bytes);
  return signature === null ? null : (SIGNATURES.get(signature) ?? null);
}

function readTag(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );
}

/**
 * Every table record, having proved each one lies inside the file.
 *
 * This is where the reported defect dies: a directory whose records point past
 * the end of the file is exactly the shape a half-finished upload has, and it
 * is what makes the parser read off the end of its DataView.
 */
function readTableIndex(view: DataView): Map<string, TableRecord> | FontCheck {
  const size = view.byteLength;
  if (size < SFNT_HEADER_BYTES) {
    return fail(`the file is only ${size} bytes long`);
  }
  const numTables = view.getUint16(4);
  if (numTables === 0) return fail("it lists no font tables at all");
  if (SFNT_HEADER_BYTES + numTables * TABLE_RECORD_BYTES > size) {
    return fail(
      `it claims ${numTables} font tables but the file ends before the list of them does`,
    );
  }

  const tables = new Map<string, TableRecord>();
  for (let i = 0; i < numTables; i++) {
    const at = SFNT_HEADER_BYTES + i * TABLE_RECORD_BYTES;
    const offset = view.getUint32(at + 8);
    const length = view.getUint32(at + 12);
    if (offset + length > size) {
      return fail(
        `its "${readTag(view, at)}" table runs past the end of the file — the upload looks incomplete`,
      );
    }
    tables.set(readTag(view, at), { offset, length });
  }
  return tables;
}

function checkHead(view: DataView, head: TableRecord): FontCheck {
  if (head.length < HEAD_MIN_BYTES) {
    return fail('its "head" table is too short to be a font header');
  }
  if (view.getUint32(head.offset + 12) !== HEAD_MAGIC) {
    return fail('its "head" table does not contain a font header');
  }
  const unitsPerEm = view.getUint16(head.offset + 18);
  if (unitsPerEm < MIN_UNITS_PER_EM || unitsPerEm > MAX_UNITS_PER_EM) {
    return fail(
      `its "head" table declares an impossible em size (${unitsPerEm})`,
    );
  }
  const locFormat = view.getInt16(head.offset + 50);
  if (locFormat !== 0 && locFormat !== 1) {
    return fail('its "head" table declares an unknown glyph index format');
  }
  return { ok: true };
}

/** hhea, hmtx and maxp have to agree, or the parser indexes off the end of
 *  hmtx while measuring the first line of text. */
function checkMetrics(
  view: DataView,
  hhea: TableRecord,
  hmtx: TableRecord,
  numGlyphs: number,
): FontCheck {
  if (hhea.length < HHEA_MIN_BYTES) {
    return fail('its "hhea" table is too short to hold horizontal metrics');
  }
  const metrics = view.getUint16(hhea.offset + 34);
  if (metrics === 0 || metrics > numGlyphs) {
    return fail('its "hhea" and "maxp" tables disagree about its glyphs');
  }
  if (hmtx.length < metrics * 4) {
    return fail('its "hmtx" table is shorter than the metrics it declares');
  }
  return { ok: true };
}

/** A truncated download usually keeps the directory and loses the tail, so the
 *  glyph index survives while the glyph data it points into does not. */
function checkGlyphIndex(
  view: DataView,
  loca: TableRecord,
  glyf: TableRecord,
  numGlyphs: number,
  locFormat: number,
): FontCheck {
  const entryBytes = locFormat === 0 ? 2 : 4;
  if (loca.length < (numGlyphs + 1) * entryBytes) {
    return fail('its "loca" table is too short for the glyphs it indexes');
  }
  const lastEntry = loca.offset + numGlyphs * entryBytes;
  const glyphDataEnd =
    entryBytes === 2
      ? view.getUint16(lastEntry) * 2
      : view.getUint32(lastEntry);
  if (glyphDataEnd > glyf.length) {
    return fail(
      'its "glyf" table is shorter than its glyph index says — the upload looks incomplete',
    );
  }
  return { ok: true };
}

function checkCharacterMap(view: DataView, cmap: TableRecord): FontCheck {
  if (cmap.length < 4) return fail('its "cmap" table is too short');
  const encodings = view.getUint16(cmap.offset + 2);
  if (encodings === 0) return fail("it maps no characters to glyphs");
  if (4 + encodings * 8 > cmap.length) {
    return fail('its "cmap" table is cut short');
  }
  for (let i = 0; i < encodings; i++) {
    const subtable = view.getUint32(cmap.offset + 8 + i * 8);
    if (subtable + 2 > cmap.length) {
      return fail("one of its character maps points past the end of the table");
    }
  }
  return { ok: true };
}

function checkTables(view: DataView): FontCheck {
  const index = readTableIndex(view);
  if (!(index instanceof Map)) return index;

  const head = index.get("head");
  const hhea = index.get("hhea");
  const hmtx = index.get("hmtx");
  const maxp = index.get("maxp");
  const cmap = index.get("cmap");
  if (!head || !hhea || !hmtx || !maxp || !cmap) {
    const missing = ["cmap", "head", "hhea", "hmtx", "maxp"].filter(
      (tag) => !index.has(tag),
    );
    const plural = missing.length > 1 ? "tables" : "table";
    return fail(`it is missing the ${missing.join(", ")} ${plural} it needs`);
  }

  const glyf = index.get("glyf");
  const loca = index.get("loca");
  const hasOutlines =
    Boolean(glyf && loca) || index.has("CFF ") || index.has("CFF2");
  if (!hasOutlines) return fail("it contains no glyph outlines");

  const headCheck = checkHead(view, head);
  if (!headCheck.ok) return headCheck;

  if (maxp.length < MAXP_MIN_BYTES)
    return fail('its "maxp" table is too short');
  const numGlyphs = view.getUint16(maxp.offset + 4);
  if (numGlyphs === 0) return fail("it contains no glyphs");

  const metricsCheck = checkMetrics(view, hhea, hmtx, numGlyphs);
  if (!metricsCheck.ok) return metricsCheck;

  if (glyf && loca) {
    const glyphCheck = checkGlyphIndex(
      view,
      loca,
      glyf,
      numGlyphs,
      view.getInt16(head.offset + 50),
    );
    if (!glyphCheck.ok) return glyphCheck;
  }

  return checkCharacterMap(view, cmap);
}

/**
 * Whether these bytes are a font this renderer can actually open.
 *
 * Never throws: an unhandled read means a file shaped like nothing we know,
 * which is the verdict we were reaching for anyway.
 *
 * The signature is tested before the length so an 8-byte PNG is refused as "not
 * a font" rather than "only 8 bytes long", which would send the user looking
 * for a longer copy of a file that was never a font.
 */
export function checkFontBytes(bytes: Uint8Array): FontCheck {
  const signature = signatureOf(bytes);
  if (signature === TTC_TAG) return fail(IS_A_COLLECTION);
  if (signature === null || !SIGNATURES.has(signature)) return fail(NOT_A_FONT);
  try {
    return checkTables(viewOf(bytes));
  } catch {
    return fail("it is not laid out like a font file");
  }
}

const MAX_FILENAME_IN_MESSAGE = 80;

export const REEXPORT_REMEDY =
  "Try re-downloading it, or export it again as a TTF or OTF.";

/** One sentence naming the file and why it was refused, shown verbatim by the
 *  upload route. The name comes from the client, so it is clamped rather than
 *  trusted to be short or present. */
export function fontRejectionMessage(
  fileName: string,
  reason: string,
  remedy: string = REEXPORT_REMEDY,
): string {
  const name = fileName.trim().slice(0, MAX_FILENAME_IN_MESSAGE) || "That file";
  return `${name} can't be used: ${reason}. ${remedy}`;
}
