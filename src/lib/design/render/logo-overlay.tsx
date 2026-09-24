import { ImageResponse } from "next/og";
import type { Canvas } from "@/lib/design/canvas";
import {
  groundLuminanceUnderLogo,
  LOGO_NOT_LEGIBLE,
  logoBackingFor,
} from "@/lib/design/logo-contrast";
import type { DesignSpec } from "@/lib/design/spec";
import { Logo } from "./layouts";

export interface LogoOverlayInput {
  /** The finished design as the model returned it. */
  image: { bytes: Uint8Array; contentType: string };
  logo: {
    bytes: Uint8Array;
    contentType: string;
    /** Darkest and lightest ink in the mark, from the loader's probe. */
    darkest: number;
    lightest: number;
    /** Width/height of the mark, so its backing plate hugs it. */
    aspect?: number;
  };
  placement: DesignSpec["logoPlacement"];
  layout: DesignSpec["layout"];
  canvas: Canvas;
}

function toDataUri(asset: { bytes: Uint8Array; contentType: string }): string {
  return `data:${asset.contentType};base64,${Buffer.from(asset.bytes).toString("base64")}`;
}

/**
 * Stamps the brand's real logo onto a design a text-capable model composed.
 *
 * The native models accept the logo as a reference image, but a diffusion
 * model redraws what it is shown — it approximates the letterforms, loses the
 * alpha channel and reshapes the mark. That cannot satisfy "unmodified,
 * undistorted, transparency preserved" (KOOS-BUG-022), so the model is asked
 * to leave the corner clear instead and the actual file is composited over its
 * output afterwards. The trade is deliberate: the model no longer sees the
 * logo, so it cannot tune the palette to it, but fidelity is what was asked
 * for and harmony was not.
 *
 * Same satori path the composite renderer already uses, so this adds no
 * dependency and the logo is placed by exactly the same code on both routes.
 */
export async function overlayLogo({
  image,
  logo,
  placement,
  layout,
  canvas,
}: LogoOverlayInput): Promise<{ bytes: Uint8Array; logoFault: string | null }> {
  if (placement === "none") {
    return { bytes: image.bytes, logoFault: null };
  }

  /* The model composed this picture, so what sits under the corner is only
     knowable by looking. Without this a navy mark landed on a navy design and
     every check called it a success. */
  /* No fallback to the flat palette colour when the model's output cannot be
     decoded: that colour is not what is under the corner of a photograph, and
     the native path explicitly accepts JPEG, which this cannot read. An
     unreadable ground means no plate, not a guessed one. */
  const decision = logoBackingFor({
    ink: { darkest: logo.darkest, lightest: logo.lightest },
    ground: await groundLuminanceUnderLogo({
      image,
      placement,
      layout,
      aspect: logo.aspect,
    }),
  });

  const response = new ImageResponse(
    <div
      style={{
        position: "relative",
        display: "flex",
        width: canvas.width,
        height: canvas.height,
        overflow: "hidden",
      }}
    >
      {/* biome-ignore lint/a11y/useAltText: satori renders to a raster, not the DOM */}
      <img
        src={toDataUri(image)}
        width="100%"
        height="100%"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
      <Logo
        uri={toDataUri(logo)}
        placement={placement}
        layout={layout}
        width={canvas.width}
        height={canvas.height}
        backing={decision.backing}
        aspect={logo.aspect}
      />
    </div>,
    { width: canvas.width, height: canvas.height },
  );
  // ImageResponse renders lazily inside the stream, so a satori or resvg
  // failure surfaces here rather than at construction.
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    logoFault: decision.legible ? null : LOGO_NOT_LEGIBLE,
  };
}
