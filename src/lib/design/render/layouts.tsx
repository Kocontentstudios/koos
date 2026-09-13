import type { Canvas } from "@/lib/design/canvas";
import {
  LOGO_BOX,
  logoInsetPx,
  logoMarkBox,
} from "@/lib/design/logo-placement";
import type { ResolvedPalette } from "@/lib/design/palette";
import {
  BANNER_BAND,
  bannerBandFor,
  fitHeadlineSize,
} from "@/lib/design/render/copy-fit";
import type { DesignSpec } from "@/lib/design/spec";

export interface LayoutArgs {
  spec: DesignSpec;
  palette: ResolvedPalette;
  canvas: Canvas;
  /** Null when the plate failed or the layout is type-only; the layout then
   * falls back to a flat palette background rather than losing the design. */
  plateDataUri: string | null;
  logoDataUri: string | null;
  /** Colour to put behind the mark when the ground would swallow it. */
  logoBacking?: string | null;
  /** Width/height of the mark, so its backing hugs it. */
  logoAspect?: number;
}

function logoCorner(
  placement: DesignSpec["logoPlacement"],
  inset: number,
): Record<string, number | string> | null {
  switch (placement) {
    case "top-left":
      return { top: inset, left: inset };
    case "top-right":
      return { top: inset, right: inset };
    case "bottom-left":
      return { bottom: inset, left: inset };
    case "bottom-right":
      return { bottom: inset, right: inset };
    default:
      return null;
  }
}

function Plate({ uri }: { uri: string }) {
  return (
    // biome-ignore lint/a11y/useAltText: satori renders to a raster, not the DOM
    // biome-ignore lint/performance/noImgElement: satori parses raw <img> only; next/image never runs here
    <img
      src={uri}
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
  );
}

/** Satori supports linear-gradient backgrounds but not blur or text-shadow,
 * so legibility over photography comes from a scrim, not an effect. */
function Scrim() {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        display: "flex",
        backgroundImage:
          "linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.05) 35%, rgba(0,0,0,0.68) 100%)",
      }}
    />
  );
}

export function Logo({
  uri,
  placement,
  layout,
  width,
  height,
  backing = null,
  aspect = LOGO_BOX.width / LOGO_BOX.height,
}: {
  uri: string;
  placement: DesignSpec["logoPlacement"];
  layout: DesignSpec["layout"];
  width: number;
  height: number;
  backing?: string | null;
  aspect?: number;
}) {
  /* Must match logoBoxIn's reference exactly, or the contrast check measures
     a different rectangle than the one drawn. */
  const reference = Math.min(width, height);
  const corner = logoCorner(placement, logoInsetPx(layout, width, height));
  if (!corner) return null;

  /* The mark's own footprint, so a backing plate is the shape of the logo
     rather than of the slot it was dropped into. */
  const mark = logoMarkBox(aspect);
  const markWidth = reference * mark.width;
  const markHeight = reference * mark.height;

  /* The plate is a WRAPPER around the mark, never padding on the mark itself.
     Satori sizes with border-box, so padding is subtracted from the element:
     a wordmark's box is only 0.22/aspect of the reference tall, and past about
     5:1 that is less than the padding — the content box collapsed and the
     design rendered a solid coloured rectangle with no logo in it at all. A
     5:1 logotype is an ordinary logo, and the failure looked exactly like the
     bug this whole change exists to fix. */
  const pad = backing ? reference * 0.012 : 0;

  return (
    <div
      style={{
        position: "absolute",
        ...corner,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: markWidth + pad * 2,
        height: markHeight + pad * 2,
        ...(backing
          ? { backgroundColor: backing, borderRadius: reference * 0.012 }
          : {}),
      }}
    >
      {/* biome-ignore lint/a11y/useAltText: satori renders to a raster, not the DOM */}
      <img
        src={uri}
        style={{
          width: markWidth,
          height: markHeight,
          objectFit: "contain",
        }}
      />
    </div>
  );
}

function Cta({
  label,
  palette,
  width,
}: {
  label: string;
  palette: ResolvedPalette;
  width: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        backgroundColor: palette.accent,
        color: palette.background,
        borderRadius: 9999,
        paddingLeft: width * 0.045,
        paddingRight: width * 0.045,
        paddingTop: width * 0.022,
        paddingBottom: width * 0.022,
        fontSize: width * 0.032,
        fontFamily: "Body",
        fontWeight: 600,
      }}
    >
      {label}
    </div>
  );
}

function CopyStack({
  spec,
  palette,
  width,
  align,
  headlineSize,
}: {
  spec: DesignSpec;
  palette: ResolvedPalette;
  /** The canvas's shorter side. Every size in the stack keys off it, like the
   *  padding does — keyed to width, a landscape design gets body copy and a
   *  button sized for 1344px inside a band 287px tall. */
  width: number;
  align: "center" | "flex-start";
  /** Sized against the room this layout actually gives the copy, because
   *  satori neither shrinks text to fit nor clips what overflows. */
  headlineSize: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: align,
        justifyContent: "center",
        gap: width * 0.028,
        textAlign: align === "center" ? "center" : "left",
      }}
    >
      <div
        style={{
          display: "flex",
          fontFamily: "Display",
          fontWeight: 700,
          fontSize: headlineSize,
          lineHeight: 1.05,
          color: palette.foreground,
        }}
      >
        {spec.headline}
      </div>
      {spec.subheadline ? (
        <div
          style={{
            display: "flex",
            fontFamily: "Body",
            fontWeight: 400,
            fontSize: width * 0.036,
            lineHeight: 1.35,
            color: palette.foreground,
            opacity: 0.92,
          }}
        >
          {spec.subheadline}
        </div>
      ) : null}
      {spec.cta ? (
        <div style={{ display: "flex", marginTop: width * 0.02 }}>
          <Cta label={spec.cta} palette={palette} width={width} />
        </div>
      ) : null}
    </div>
  );
}

export function layoutElement({
  spec,
  palette,
  canvas,
  plateDataUri,
  logoDataUri,
  logoBacking = null,
  logoAspect,
}: LayoutArgs) {
  const { width, height } = canvas;
  /* Keyed to the SHORTER side, like the logo inset. At 16:9 a padding of 8%
     of the width is 107px on a 756px-tall canvas — 215px of a 287px band, so
     banner-bottom had 72px left for a headline, a subheadline and a button.
     Only landscape changes; the portrait and square canvases are all
     width-limited and keep the margin they had. */
  const pad = Math.min(width, height) * 0.08;
  const overPhoto = Boolean(plateDataUri);
  // Copy sits on the scrim when there is a plate, so it must read as light.
  const copyPalette: ResolvedPalette = overPhoto
    ? { ...palette, foreground: "#FFFFFF" }
    : palette;

  /* Sized once from the space THIS layout leaves, not from the headline's
     character count — the same words got the same size in hero-center, which
     has the whole canvas, and in banner-bottom, which has a third of it. */
  const reference = Math.min(width, height);
  /* banner-bottom's band grows to fit rather than overflowing, so the fit has
     to be measured against the band that will actually be drawn. */
  const bannerBand =
    spec.layout === "banner-bottom"
      ? bannerBandFor({ spec, canvas })
      : undefined;
  const headline = fitHeadlineSize({
    spec,
    layout: spec.layout,
    canvas,
    bannerBand,
  });

  const frame = {
    position: "relative" as const,
    display: "flex" as const,
    width,
    height,
    backgroundColor: palette.background,
    overflow: "hidden" as const,
  };

  const logo = logoDataUri ? (
    <Logo
      uri={logoDataUri}
      placement={spec.logoPlacement}
      layout={spec.layout}
      width={width}
      height={height}
      backing={logoBacking}
      aspect={logoAspect}
    />
  ) : null;

  if (spec.layout === "split-left") {
    return (
      <div style={frame}>
        {plateDataUri ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              width: width * 0.52,
              height,
              display: "flex",
            }}
          >
            <Plate uri={plateDataUri} />
          </div>
        ) : null}
        <div
          style={{
            display: "flex",
            width: width * 0.52,
            height,
            padding: pad,
            backgroundColor: palette.background,
          }}
        >
          <CopyStack
            spec={spec}
            palette={palette}
            width={reference}
            align="flex-start"
            headlineSize={headline}
          />
        </div>
        {logo}
      </div>
    );
  }

  if (spec.layout === "banner-bottom") {
    return (
      <div style={{ ...frame, flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            width,
            height: height * (1 - (bannerBand ?? BANNER_BAND.min)),
            position: "relative",
          }}
        >
          {plateDataUri ? <Plate uri={plateDataUri} /> : null}
        </div>
        <div
          style={{
            display: "flex",
            width,
            height: height * (bannerBand ?? BANNER_BAND.min),
            padding: pad,
            backgroundColor: palette.background,
          }}
        >
          <CopyStack
            spec={spec}
            palette={palette}
            width={reference}
            align="flex-start"
            headlineSize={headline}
          />
        </div>
        {logo}
      </div>
    );
  }

  if (spec.layout === "quote-card" || spec.layout === "stat-highlight") {
    return (
      <div style={frame}>
        {plateDataUri ? <Plate uri={plateDataUri} /> : null}
        {plateDataUri ? <Scrim /> : null}
        <div
          style={{
            position: "absolute",
            top: pad,
            left: pad,
            right: pad,
            bottom: pad,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: pad,
            borderRadius: width * 0.04,
            backgroundColor: overPhoto
              ? "rgba(0,0,0,0.42)"
              : palette.background,
            borderWidth: spec.layout === "stat-highlight" ? width * 0.006 : 0,
            borderStyle: "solid",
            borderColor: palette.accent,
          }}
        >
          <CopyStack
            spec={spec}
            palette={copyPalette}
            width={reference}
            align="center"
            headlineSize={headline}
          />
        </div>
        {logo}
      </div>
    );
  }

  return (
    <div style={frame}>
      {plateDataUri ? <Plate uri={plateDataUri} /> : null}
      {plateDataUri ? <Scrim /> : null}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: pad,
        }}
      >
        <CopyStack
          spec={spec}
          palette={copyPalette}
          width={reference}
          align="center"
          headlineSize={headline}
        />
      </div>
      {logo}
    </div>
  );
}
