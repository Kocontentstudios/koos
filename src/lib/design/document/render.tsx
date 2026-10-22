import type { CSSProperties, ReactElement } from "react";
import type {
  ButtonElement,
  DesignDocument,
  DesignElement,
  ImageElement,
  LogoElement,
  ShapeElement,
  TextElement,
} from "./schema";

/**
 * One renderer for the layer document, in the subset of CSS satori draws.
 *
 * The same element tree goes to satori on the server and to react-dom in the
 * editor, so every property used here has to mean the same thing in both:
 * absolute boxes, flex, rotate(), opacity, border radius, object-fit and
 * linear gradients. render.test.tsx pins the property list, which is what
 * stops a browser-only property sneaking in and making the editor disagree
 * with the export.
 */

/** Font family names as registered with satori (render/fonts.ts SOURCES). The
 *  editor passes the names its @font-face rules use. */
export interface FontFamilies {
  heading: string;
  body: string;
}

export const DEFAULT_FONT_FAMILIES: FontFamilies = {
  heading: "Display",
  body: "Body",
};

/** Asset key to something an <img> can load: a data URI on the server, a
 *  signed URL in the browser. */
export type AssetSources = Record<string, string>;

type TextLook = Pick<
  TextElement,
  | "font"
  | "fontSize"
  | "fontWeight"
  | "lineHeight"
  | "letterSpacing"
  | "align"
  | "italic"
  | "color"
>;

/**
 * The style of the box that holds a run of text.
 *
 * Exported because the text fitter lays out probes with exactly this style:
 * if the measurement and the render ever used different properties, a size
 * that measured as fitting could overflow when drawn.
 *
 * Plain greedy wrapping, the one line-breaking rule satori and Chromium
 * agree on. text-wrap: balance broke lines in different places in the two
 * engines (B5), so balancing is done by the builder instead, by narrowing
 * the box (fit.ts balancedWidth).
 *
 * break-word, so a word wider than its box breaks rather than running out
 * of it. Both engines break a word only when it cannot fit a line on its
 * own, and the fitter only lets that happen at the legibility floor, with a
 * fault reported (fit.ts tier 4). Text a user types in the editor gets the
 * same guarantee for free.
 *
 * justifyContent places the run where textAlign says in satori, which lays a
 * run out as a flex row; a browser ignores it on a block and aligns with
 * textAlign alone, so both land in the same place.
 */
const JUSTIFY = {
  left: "flex-start",
  center: "center",
  right: "flex-end",
} as const;

/**
 * The narrowest line a run may break words on.
 *
 * Satori never returns when break-word meets a line narrower than one glyph:
 * it keeps splitting a grapheme that cannot be split. A schema-valid edit (a
 * box dragged narrower than a letter, a button narrower than its padding)
 * would hang the renderer, so below this width words do not break and the
 * run overflows instead. Three ems plus the tracking is wider than any glyph
 * the bundled or fallback faces draw; every builder box is many times it.
 */
export function minBreakableWidth(
  look: Pick<TextLook, "fontSize" | "letterSpacing">,
): number {
  return look.fontSize * (3 + Math.max(0, look.letterSpacing));
}

export function textRunStyle(
  look: TextLook,
  fonts: FontFamilies = DEFAULT_FONT_FAMILIES,
  /** The width the run is laid out in, when known. */
  lineWidth?: number,
): CSSProperties {
  const breaksWords =
    lineWidth === undefined || lineWidth >= minBreakableWidth(look);
  return {
    display: "block",
    fontFamily: look.font === "heading" ? fonts.heading : fonts.body,
    fontSize: look.fontSize,
    fontWeight: look.fontWeight,
    fontStyle: look.italic ? "italic" : "normal",
    lineHeight: look.lineHeight,
    letterSpacing: look.letterSpacing * look.fontSize,
    textAlign: look.align,
    color: look.color,
    wordBreak: breaksWords ? "break-word" : "normal",
    justifyContent: JUSTIFY[look.align],
  };
}

/** Horizontal padding inside a button, as a function of its type size so the
 *  builder and the renderer derive the same label width. */
export function buttonPaddingX(fontSize: number): number {
  return Math.round(fontSize * 1.4);
}

export function buttonPaddingY(fontSize: number): number {
  return Math.round(fontSize * 0.7);
}

export const BUTTON_LINE_HEIGHT = 1.2;

/** The plate behind a logo extends past the mark by this much, so the mark
 *  itself stays exactly where the contrast check measured it. */
export function logoBackingPad(doc: Pick<DesignDocument, "width" | "height">) {
  return Math.round(Math.min(doc.width, doc.height) * 0.012);
}

function isGradient(fill: string): boolean {
  return fill.startsWith("linear-gradient");
}

function fillStyle(fill: string): CSSProperties {
  return isGradient(fill)
    ? { backgroundImage: fill }
    : { backgroundColor: fill };
}

function boxStyle(
  element: Pick<
    DesignElement,
    "x" | "y" | "width" | "height" | "rotation" | "opacity"
  >,
): CSSProperties {
  return {
    position: "absolute",
    left: element.x,
    top: element.y,
    width: element.width,
    height: element.height,
    display: "flex",
    opacity: element.opacity,
    ...(element.rotation
      ? { transform: `rotate(${element.rotation}deg)` }
      : {}),
  };
}

function ImageLayer({ element, src }: { element: ImageElement; src: string }) {
  const { zoom, focusX, focusY } = element.crop;
  const width = element.width * zoom;
  const height = element.height * zoom;
  return (
    <div
      data-element-id={element.id}
      style={{
        ...boxStyle(element),
        overflow: "hidden",
        borderRadius: element.radius,
      }}
    >
      {/* biome-ignore lint/a11y/useAltText: satori renders to a raster; the editor labels the layer itself */}
      <img
        src={src}
        width={width}
        height={height}
        style={{
          position: "absolute",
          /* Zoom enlarges the drawn box and the focus point decides which
             part of the enlargement stays inside the frame. Expressed as an
             offset plus object-position because that is the one formulation
             satori and the browser compute identically. */
          left: (element.width - width) * focusX,
          top: (element.height - height) * focusY,
          width,
          height,
          objectFit: element.fit,
          objectPosition: `${focusX * 100}% ${focusY * 100}%`,
        }}
      />
    </div>
  );
}

function ShapeLayer({ element }: { element: ShapeElement }) {
  return (
    <div
      data-element-id={element.id}
      style={{
        ...boxStyle(element),
        ...fillStyle(element.fill),
        borderRadius: element.radius,
        ...(element.borderWidth > 0
          ? {
              borderWidth: element.borderWidth,
              borderStyle: "solid",
              borderColor: element.borderColor,
            }
          : {}),
      }}
    />
  );
}

function TextLayer({
  element,
  fonts,
}: {
  element: TextElement;
  fonts: FontFamilies;
}) {
  return (
    <div
      data-element-id={element.id}
      style={{
        ...boxStyle(element),
        flexDirection: "column",
        /* The builder sizes a text box to its laid-out height plus a margin
           for glyphs that overshoot the line box (accents, descenders);
           centring splits that margin evenly above and below. */
        justifyContent: "center",
      }}
    >
      <div style={textRunStyle(element, fonts, element.width)}>
        {element.text}
      </div>
    </div>
  );
}

function ButtonLayer({
  element,
  fonts,
}: {
  element: ButtonElement;
  fonts: FontFamilies;
}) {
  const labelWidth = Math.max(
    0,
    element.width - buttonPaddingX(element.fontSize) * 2,
  );
  return (
    <div
      data-element-id={element.id}
      style={{
        ...boxStyle(element),
        ...fillStyle(element.fill),
        alignItems: "center",
        justifyContent: "center",
        borderRadius: element.radius,
      }}
    >
      <div
        style={{
          ...textRunStyle(
            {
              font: "body",
              fontSize: element.fontSize,
              fontWeight: element.fontWeight,
              lineHeight: BUTTON_LINE_HEIGHT,
              letterSpacing: 0,
              align: "center",
              italic: false,
              color: element.color,
            },
            fonts,
            labelWidth,
          ),
          maxWidth: labelWidth,
        }}
      >
        {element.label}
      </div>
    </div>
  );
}

function LogoLayer({
  element,
  src,
  pad,
}: {
  element: LogoElement;
  src: string;
  pad: number;
}) {
  const inset = element.backing ? pad : 0;
  return (
    <div
      data-element-id={element.id}
      style={{
        ...boxStyle({
          ...element,
          x: element.x - inset,
          y: element.y - inset,
          width: element.width + inset * 2,
          height: element.height + inset * 2,
        }),
        alignItems: "center",
        justifyContent: "center",
        ...(element.backing
          ? { backgroundColor: element.backing, borderRadius: pad }
          : {}),
      }}
    >
      {/* biome-ignore lint/a11y/useAltText: satori renders to a raster; the editor labels the layer itself */}
      <img
        src={src}
        width={element.width}
        height={element.height}
        style={{
          width: element.width,
          height: element.height,
          objectFit: "contain",
        }}
      />
    </div>
  );
}

function layer(
  element: DesignElement,
  assets: AssetSources,
  fonts: FontFamilies,
  logoPad: number,
): ReactElement | null {
  switch (element.type) {
    case "image": {
      const src = assets[element.asset.key];
      return src ? (
        <ImageLayer key={element.id} element={element} src={src} />
      ) : null;
    }
    case "shape":
      return <ShapeLayer key={element.id} element={element} />;
    case "text":
      return <TextLayer key={element.id} element={element} fonts={fonts} />;
    case "button":
      return <ButtonLayer key={element.id} element={element} fonts={fonts} />;
    case "logo": {
      const src = assets[element.asset.key];
      return src ? (
        <LogoLayer key={element.id} element={element} src={src} pad={logoPad} />
      ) : null;
    }
  }
}

/** The elements that will actually be drawn, in z-order. An element whose
 *  asset is not available is left out rather than drawn as a broken image. */
export function drawnElements(
  doc: DesignDocument,
  assets: AssetSources,
): DesignElement[] {
  return doc.elements.filter((element) => {
    if (element.hidden) return false;
    if (element.type === "image" || element.type === "logo") {
      return Boolean(assets[element.asset.key]);
    }
    return true;
  });
}

export function documentElement(
  doc: DesignDocument,
  assets: AssetSources,
  fonts: FontFamilies = DEFAULT_FONT_FAMILIES,
): ReactElement {
  const logoPad = logoBackingPad(doc);
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        width: doc.width,
        height: doc.height,
        backgroundColor: doc.background,
        overflow: "hidden",
      }}
    >
      {drawnElements(doc, assets).map((element) =>
        layer(element, assets, fonts, logoPad),
      )}
    </div>
  );
}
