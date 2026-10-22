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

/** `rgba` is unpremultiplied 8-bit RGBA, as getImageData and sharp return. */
export function measureSubject(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): SubjectMeasure {
  const count = width * height;
  if (count === 0 || rgba.length < count * CHANNELS) {
    return { coverage: 0, edgeEnergy: 0 };
  }
  const pixels = onGrey(rgba, count);
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
      if (deviation > SUBJECT_DEVIATION) far += 1;
      edges += edge;
    }
  }
  return { coverage: far / count, edgeEnergy: edges / count };
}

export function looksBlank({ coverage, edgeEnergy }: SubjectMeasure): boolean {
  return coverage < MIN_SUBJECT_COVERAGE && edgeEnergy < MIN_EDGE_ENERGY;
}

function onGrey(rgba: Uint8Array | Uint8ClampedArray, count: number) {
  const out = new Float32Array(count * CHANNELS);
  for (let i = 0; i < count * CHANNELS; i += CHANNELS) {
    const alpha = rgba[i + 3] / 255;
    for (let c = 0; c < 3; c += 1) {
      out[i + c] = rgba[i + c] * alpha + MID_GREY * (1 - alpha);
    }
    out[i + 3] = rgba[i + 3];
  }
  return out;
}

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
