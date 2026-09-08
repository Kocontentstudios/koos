import { ImageResponse } from "next/og";

/**
 * SVG to PNG, so a vector logo can reach a vision model.
 *
 * Bedrock rejects SVG both ways: declared as image/svg+xml the SDK refuses it
 * (AI_UnsupportedFunctionalityError), and declared as image/png the API
 * answers "Could not process image". Since /api/upload accepts image/svg+xml
 * for logos, and a logo is the one asset most likely to BE an SVG, "Pick from
 * logo" silently returned nothing for exactly the brands most likely to use it
 * (KOOS-BUG-014).
 *
 * Uses next/og, which the design renderer already depends on — it bundles
 * satori and resvg, so this adds no dependency. Rendered onto an opaque white
 * ground: a transparent SVG composited on black turns a dark logo invisible,
 * and the model would report the background instead of the brand.
 */
const RASTER_SIZE = 512;

export async function rasterizeSvg(bytes: Uint8Array): Promise<Uint8Array> {
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(bytes).toString("base64")}`;
  const response = new ImageResponse(
    {
      type: "div",
      props: {
        style: {
          display: "flex",
          width: `${RASTER_SIZE}px`,
          height: `${RASTER_SIZE}px`,
          background: "#ffffff",
        },
        children: {
          type: "img",
          props: { src: dataUri, width: RASTER_SIZE, height: RASTER_SIZE },
        },
      },
    } as never,
    { width: RASTER_SIZE, height: RASTER_SIZE },
  );
  // ImageResponse renders lazily inside the stream, so a satori or resvg
  // failure surfaces here rather than at construction.
  return new Uint8Array(await response.arrayBuffer());
}
