/**
 * How many directions to render at once.
 *
 * A render holds the canvas, every embedded image decoded to RGBA, satori's
 * tree and resvg's own copy of the pixels, so its peak grows with the size of
 * the image it draws. Two at once halves the wait on a machine with room for
 * both; on one without, the second render pushes the function into swap or
 * out of memory and the user loses both. The answer comes from the memory
 * actually free when the job reaches this point.
 */

/** Satori, resvg and two decoded canvases at the largest supported size
 *  (1080x1920), with headroom for the fonts. */
export const RENDER_BASE_BYTES = 192 * 1024 * 1024;

/** Per pixel of embedded image: decoded RGBA for satori, resvg's copy, and
 *  the base64 data URI the bytes travel in. */
export const BYTES_PER_IMAGE_PIXEL = 12;

export function renderConcurrency({
  directions,
  freeBytes,
  imagePixels,
}: {
  directions: number;
  freeBytes: number;
  /** Width times height of the largest image a direction embeds. */
  imagePixels: number;
}): number {
  const perRender = RENDER_BASE_BYTES + imagePixels * BYTES_PER_IMAGE_PIXEL;
  const fits = Math.floor(freeBytes / perRender);
  return Math.max(1, Math.min(directions, fits));
}
