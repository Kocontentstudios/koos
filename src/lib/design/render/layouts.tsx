import type { Canvas } from "@/lib/design/canvas";
import type { ResolvedPalette } from "@/lib/design/palette";
import type { DesignSpec } from "@/lib/design/spec";

export interface LayoutArgs {
  spec: DesignSpec;
  palette: ResolvedPalette;
  canvas: Canvas;
  /** Null when the plate failed or the layout is type-only; the layout then
   * falls back to a flat palette background rather than losing the design. */
  plateDataUri: string | null;
  logoDataUri: string | null;
}

/** Satori cannot shrink text to fit, so size is picked from a ladder keyed on
 * character count instead. */
function headlineSize(headline: string, width: number): number {
  if (headline.length <= 18) return width * 0.11;
  if (headline.length <= 34) return width * 0.078;
  return width * 0.058;
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

function Logo({
  uri,
  placement,
  width,
}: {
  uri: string;
  placement: DesignSpec["logoPlacement"];
  width: number;
}) {
  const corner = logoCorner(placement, width * 0.05);
  if (!corner) return null;
  return (
    // biome-ignore lint/a11y/useAltText: satori renders to a raster, not the DOM
    // biome-ignore lint/performance/noImgElement: satori parses raw <img> only; next/image never runs here
    <img
      src={uri}
      style={{
        position: "absolute",
        ...corner,
        width: width * 0.14,
        objectFit: "contain",
      }}
    />
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
}: {
  spec: DesignSpec;
  palette: ResolvedPalette;
  width: number;
  align: "center" | "flex-start";
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
          fontSize: headlineSize(spec.headline, width),
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
}: LayoutArgs) {
  const { width, height } = canvas;
  const pad = width * 0.08;
  const overPhoto = Boolean(plateDataUri);
  // Copy sits on the scrim when there is a plate, so it must read as light.
  const copyPalette: ResolvedPalette = overPhoto
    ? { ...palette, foreground: "#FFFFFF" }
    : palette;

  const frame = {
    position: "relative" as const,
    display: "flex" as const,
    width,
    height,
    backgroundColor: palette.background,
    overflow: "hidden" as const,
  };

  const logo = logoDataUri ? (
    <Logo uri={logoDataUri} placement={spec.logoPlacement} width={width} />
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
            width={width}
            align="flex-start"
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
            height: height * 0.62,
            position: "relative",
          }}
        >
          {plateDataUri ? <Plate uri={plateDataUri} /> : null}
        </div>
        <div
          style={{
            display: "flex",
            width,
            height: height * 0.38,
            padding: pad,
            backgroundColor: palette.background,
          }}
        >
          <CopyStack
            spec={spec}
            palette={palette}
            width={width}
            align="flex-start"
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
            width={width}
            align="center"
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
          width={width}
          align="center"
        />
      </div>
      {logo}
    </div>
  );
}
