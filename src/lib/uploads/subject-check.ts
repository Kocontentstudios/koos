/**
 * Whether an image has anything in it to show: a deterministic test for a
 * blank, near-uniform or subject-free upload (a photo of a white sheet, a
 * flat colour), run by the browser normaliser before upload and by the
 * server loader at generation, on the same small thumbnail and the same
 * numbers. Framework-free and free of server imports so the browser bundle
 * can use it.
 *
 * Mean brightness alone cannot tell a white sheet from a small dark product
 * on a white table: both average near white. Two measures can:
 *
 *  - coverage, the share of thumbnail pixels that differ from the image's
 *    median colour by more than SUBJECT_DEVIATION in any channel. A product
 *    on white is a small share far from white; a wall texture is every
 *    pixel a little off white, which the downscale averages away.
 *  - edge energy, the mean of |dx| + |dy| (largest channel), the catch for an
 *    image with structure everywhere and no single region far from the
 *    median.
 *
 * An image looks blank only when both are low. Transparent pixels are
 * composited onto mid grey and alpha is measured as a fourth channel, so a
 * cutout's silhouette counts as a subject whatever its colour.
 *
 * Measured on the U3 live critic's photos (spec, Upload, "Blank and
 * subject-free images"), on the server and browser thumbnails: photo-a, a
 * near-white photo, coverage 0% and edge energy 0.2 to 1.0; photo-b, a white
 * wall, coverage 0% and edge energy 2.3 to 2.4; four real photos and a real
 * cutout, coverage 21 to 88% and edge energy 17 to 46. A dark bottle 5% of
 * the frame wide on white covers 0.78%.
 */

/* Long edge of the thumbnail both sides measure. Small enough that texture
   and JPEG noise average out, large enough that a subject 5% of the frame
   wide still covers a dozen pixels. */
export const SUBJECT_THUMBNAIL_SIDE = 64;

/* Out of 255. photo-b's wall texture peaks at 22 on the thumbnail; a pale
   grey product on white (#d6d6d6) sits at 41. */
export const SUBJECT_DEVIATION = 24;

/* 0.2% of the thumbnail, about 8 pixels of a 64 x 64. The smallest legitimate
   subject tested, a dark bottle 5% of the frame wide, covers 0.78%. */
export const MIN_SUBJECT_COVERAGE = 0.002;

/* Over three times photo-b's 2.4; every real photo tested is above 16.8.
   Only reached when coverage is under its floor. */
export const MIN_EDGE_ENERGY = 8;

const MID_GREY = 128;
const CHANNELS = 4;

export interface SubjectMeasure {
  /** Share of pixels, 0 to 1, far from the median colour. */
  coverage: number;
  /** Mean |dx| + |dy| of the largest-changing channel, 0 to 510. */
  edgeEnergy: number;
}

/** Pixels composited on mid grey with alpha as a fourth channel, unrounded. */
export interface SubjectThumbnail {
  pixels: Float32Array;
  width: number;
  height: number;
}

/** The thumbnail size for an image, fitted inside SUBJECT_THUMBNAIL_SIDE. */
export function subjectThumbnailSize(
  width: number,
  height: number,
): { width: number; height: number } {
  const scale = Math.min(1, SUBJECT_THUMBNAIL_SIDE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The thumbnail both sides measure, drawn by this code rather than by a
 * resampler: an exact area average of the full-size pixels, in floating
 * point. The browser used a canvas and the server libvips; on a fine pattern
 * (a 1 px checkerboard, a halftone) the two resamplers alias differently, so
 * the same image could be refused in one and accepted in the other. An area
 * average is linear, so the JPEG the browser uploads, whose error averages
 * out over each thumbnail cell, measures within a level of the canvas it was
 * encoded from.
 *
 * `data` is unpremultiplied 8-bit pixels with `channels` per pixel, as sharp
 * and getImageData return them.
 */
export function subjectThumbnail(
  data: ArrayLike<number>,
  width: number,
  height: number,
  channels: 3 | 4,
): SubjectThumbnail {
  if (width * height === 0 || data.length < width * height * channels) {
    return { pixels: new Float32Array(0), width: 0, height: 0 };
  }
  const size = subjectThumbnailSize(width, height);
  const columns = cellSpans(width, size.width);
  const rows = cellSpans(height, size.height);

  const across = new Float32Array(height * size.width * CHANNELS);
  for (let y = 0; y < height; y += 1) {
    const rowOut = y * size.width;
    let at = y * width * channels;
    for (let x = 0; x < width; x += 1, at += channels) {
      const alpha = channels === 4 ? data[at + 3] : 255;
      const opacity = alpha / 255;
      const grey = MID_GREY * (1 - opacity);
      const r = data[at] * opacity + grey;
      const g = data[at + 1] * opacity + grey;
      const b = data[at + 2] * opacity + grey;
      const share = columns.share[x];
      let to = (rowOut + columns.cell[x]) * CHANNELS;
      across[to] += r * share;
      across[to + 1] += g * share;
      across[to + 2] += b * share;
      across[to + 3] += alpha * share;
      if (share < 1) {
        const rest = 1 - share;
        to += CHANNELS;
        across[to] += r * rest;
        across[to + 1] += g * rest;
        across[to + 2] += b * rest;
        across[to + 3] += alpha * rest;
      }
    }
  }

  const pixels = new Float32Array(size.width * size.height * CHANNELS);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      const from = (y * size.width + x) * CHANNELS;
      const source = across.subarray(from, from + CHANNELS);
      const to = (rows.cell[y] * size.width + x) * CHANNELS;
      addWeighted(pixels, to, source, rows.share[y]);
      if (rows.share[y] < 1) {
        addWeighted(
          pixels,
          to + size.width * CHANNELS,
          source,
          1 - rows.share[y],
        );
      }
    }
  }
  const area = (width / size.width) * (height / size.height);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] /= area;
  return { pixels, width: size.width, height: size.height };
}

/* For each source pixel, the thumbnail cell its left edge falls in and the
   share of the pixel inside that cell; the rest is in the next cell. A cell
   is at least one pixel wide, so no pixel spans three. */
function cellSpans(source: number, cells: number) {
  const cellWidth = source / cells;
  const cell = new Int32Array(source);
  const share = new Float32Array(source);
  for (let i = 0; i < source; i += 1) {
    const index = Math.min(cells - 1, Math.floor(i / cellWidth));
    cell[i] = index;
    share[i] = Math.min(1, (index + 1) * cellWidth - i);
    if (index === cells - 1) share[i] = 1;
  }
  return { cell, share };
}

function addWeighted(
  into: Float32Array,
  at: number,
  pixel: Float32Array,
  weight: number,
): void {
  for (let c = 0; c < CHANNELS; c += 1) into[at + c] += pixel[c] * weight;
}

export function measureSubject(
  { pixels, width, height }: SubjectThumbnail,
  deviationLimit: number = SUBJECT_DEVIATION,
): SubjectMeasure {
  const count = width * height;
  if (count === 0 || pixels.length < count * CHANNELS) {
    return { coverage: 0, edgeEnergy: 0 };
  }
  const median = channelMedians(pixels, count);

  let far = 0;
  let edges = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * CHANNELS;
      const right = x + 1 < width ? at + CHANNELS : at;
      const below = y + 1 < height ? at + width * CHANNELS : at;
      let deviation = 0;
      let edge = 0;
      for (let c = 0; c < CHANNELS; c += 1) {
        const v = pixels[at + c];
        deviation = Math.max(deviation, Math.abs(v - median[c]));
        edge = Math.max(
          edge,
          Math.abs(v - pixels[right + c]) + Math.abs(v - pixels[below + c]),
        );
      }
      if (deviation > deviationLimit) far += 1;
      edges += edge;
    }
  }
  return { coverage: far / count, edgeEnergy: edges / count };
}

/** The server's decision, and the one that counts. */
export function looksBlank({ coverage, edgeEnergy }: SubjectMeasure): boolean {
  return coverage < MIN_SUBJECT_COVERAGE && edgeEnergy < MIN_EDGE_ENERGY;
}

/**
 * The browser's decision: blank only past a margin on every measure, so the
 * browser never refuses an image the server would accept. The server measures
 * the JPEG the browser encoded from its canvas, not the canvas, and that
 * difference is what the margin covers (spec, Upload, "Blank and
 * subject-free images", parity). Anything inside the margin is uploaded and
 * the server decides.
 */
export function browserLooksBlank(thumbnail: SubjectThumbnail): boolean {
  const { coverage, edgeEnergy } = measureSubject(
    thumbnail,
    SUBJECT_DEVIATION - BROWSER_MARGIN.deviation,
  );
  return (
    coverage < MIN_SUBJECT_COVERAGE &&
    edgeEnergy < MIN_EDGE_ENERGY - BROWSER_MARGIN.edgeEnergy
  );
}

/* In Chromium, on the fine-pattern parity set, the browser's thumbnail sat
   within 0.52 of the server's on every channel and its edge energy within
   0.18 (eval:subject-parity). The margin is about eight times that, for the
   encoders not measured there (Safari's ImageIO, Firefox's). */
export const BROWSER_MARGIN = { deviation: 4, edgeEnergy: 2 };

function channelMedians(pixels: Float32Array, count: number): number[] {
  const medians: number[] = [];
  const values = new Float32Array(count);
  for (let c = 0; c < CHANNELS; c += 1) {
    for (let i = 0; i < count; i += 1) values[i] = pixels[i * CHANNELS + c];
    values.sort();
    medians.push(values[count >> 1]);
  }
  return medians;
}
