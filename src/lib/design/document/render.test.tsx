import { render } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import {
  IMAGE,
  LAYOUTS,
  LOGO,
  LOGO_ASPECT,
  monospaceMeasurer,
  PALETTE,
  RATIOS,
  specFor,
} from "./fixtures";
import { documentFromSpec } from "./from-spec";
import {
  buttonPaddingX,
  DEFAULT_FONT_FAMILIES,
  documentElement,
  drawnElements,
  logoBackingPad,
  minBreakableWidth,
  textRunStyle,
} from "./render";
import type { DesignDocument, ImageElement, LogoElement } from "./schema";

/**
 * The renderer's contract with satori: only properties satori draws, with
 * values it parses. Listed here rather than derived, because the point is to
 * fail loudly when someone adds a property that renders in the editor and
 * silently does nothing in the exported PNG.
 */
const SATORI_PROPERTIES = new Set([
  "position",
  "left",
  "top",
  "width",
  "height",
  "maxWidth",
  "display",
  "flexDirection",
  "justifyContent",
  "alignItems",
  "opacity",
  "transform",
  "overflow",
  "borderRadius",
  "borderWidth",
  "borderStyle",
  "borderColor",
  "backgroundColor",
  "backgroundImage",
  "objectFit",
  "objectPosition",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "wordBreak",
  "color",
]);

/* Browser-only, and only ever set to the value that makes the browser do
   what satori already does (render.tsx SATORI_SHAPING). */
const BROWSER_MATCHES_SATORI: Record<string, string> = {
  fontKerning: "none",
  fontVariantLigatures: "none",
};

const ASSETS = {
  [IMAGE.key]: "data:image/png;base64,AAAA",
  [LOGO.key]: "data:image/png;base64,BBBB",
};

function hostElements(node: ReactNode): ReactElement[] {
  const found: ReactElement[] = [];
  const visit = (current: ReactNode) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!isValidElement(current)) return;
    const element = current as ReactElement<{
      children?: ReactNode;
      [key: string]: unknown;
    }>;
    if (typeof element.type === "string") {
      found.push(element);
      visit(element.props.children);
      return;
    }
    const component = element.type as (props: unknown) => ReactNode;
    visit(component(element.props));
  };
  visit(node);
  return found;
}

async function everyBuilderOutput(): Promise<DesignDocument[]> {
  const measurer = monospaceMeasurer();
  const docs: DesignDocument[] = [];
  for (const layout of LAYOUTS) {
    for (const ratio of RATIOS) {
      for (const image of [IMAGE, null]) {
        for (const logo of [{ asset: LOGO, aspect: LOGO_ASPECT }, null]) {
          const { document } = await documentFromSpec({
            spec: specFor(layout, ratio),
            palette: PALETTE,
            canvas: canvasFor(ratio),
            image,
            logo,
            measurer,
          });
          docs.push(document);
        }
      }
    }
  }
  return docs;
}

describe("documentElement", () => {
  it("uses only satori-supported CSS on every builder output", async () => {
    for (const doc of await everyBuilderOutput()) {
      for (const element of hostElements(documentElement(doc, ASSETS))) {
        expect(["div", "img"]).toContain(element.type);
        const style = (element.props as { style?: Record<string, unknown> })
          .style;
        for (const [property, value] of Object.entries(style ?? {})) {
          if (property in BROWSER_MATCHES_SATORI) {
            expect(value).toBe(BROWSER_MATCHES_SATORI[property]);
            continue;
          }
          expect(SATORI_PROPERTIES, property).toContain(property);
          const text = String(value);
          expect(text).not.toMatch(/calc\(|var\(|url\(|!important/);
          if (property === "display") {
            expect(["flex", "block", "none"]).toContain(text);
          }
          if (property === "transform") {
            expect(text).toMatch(/^rotate\(-?[\d.]+deg\)$/);
          }
          /* B5: balance wrapping broke lines differently in satori and
             Chromium. Only break-word, which both engines apply the same
             way (to a word wider than its line), may change wrapping, and
             every builder box is wide enough to allow it. */
          if (property === "wordBreak") expect(text).toBe("break-word");
          expect(property).not.toBe("textWrap");
        }
      }
    }
  });

  it("renders in the DOM with one node per drawn element, in z-order", async () => {
    for (const doc of await everyBuilderOutput()) {
      const element = documentElement(doc, ASSETS);
      const { container, unmount } = render(element);
      const drawn = Array.from(
        container.querySelectorAll("[data-element-id]"),
      ).map((node) => node.getAttribute("data-element-id"));
      expect(drawn).toEqual(drawnElements(doc, ASSETS).map((e) => e.id));
      // Same host tree satori receives: nothing added or lost by react-dom.
      expect(container.querySelectorAll("*").length).toBe(
        hostElements(element).length,
      );
      unmount();
    }
  });

  it("leaves out hidden elements and elements whose asset is missing", async () => {
    const [doc] = await everyBuilderOutput();
    const hidden = {
      ...doc,
      elements: doc.elements.map((element) =>
        element.id === "headline" ? { ...element, hidden: true } : element,
      ),
    };
    const ids = drawnElements(hidden, { [LOGO.key]: "data:," }).map(
      (e) => e.id,
    );
    expect(ids).not.toContain("headline");
    expect(ids).not.toContain("image");
    expect(ids).toContain("logo");
  });

  it("crops an image by zoom and focus the way CSS does", () => {
    const image: ImageElement = {
      id: "image",
      name: "Image",
      type: "image",
      x: 10,
      y: 20,
      width: 400,
      height: 300,
      rotation: 0,
      opacity: 1,
      hidden: false,
      locked: false,
      asset: IMAGE,
      fit: "cover",
      crop: { zoom: 2, focusX: 0.25, focusY: 1 },
      radius: 12,
    };
    const doc: DesignDocument = {
      version: 1,
      width: 500,
      height: 500,
      background: "#FFFFFF",
      elements: [image],
    };
    const { container } = render(documentElement(doc, ASSETS));
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.style.width).toBe("800px");
    expect(img.style.height).toBe("600px");
    // (400 - 800) * 0.25 and (300 - 600) * 1.
    expect(img.style.left).toBe("-100px");
    expect(img.style.top).toBe("-300px");
    expect(img.style.objectPosition).toBe("25% 100%");
  });

  it("draws a logo backing outside the mark so the mark stays where it was measured", () => {
    const logo: LogoElement = {
      id: "logo",
      name: "Logo",
      type: "logo",
      x: 800,
      y: 86,
      width: 200,
      height: 50,
      rotation: 0,
      opacity: 1,
      hidden: false,
      locked: false,
      asset: LOGO,
      backing: "#FFFFFF",
    };
    const doc: DesignDocument = {
      version: 1,
      width: 1080,
      height: 1350,
      background: "#000000",
      elements: [logo],
    };
    const pad = logoBackingPad(doc);
    const { container } = render(documentElement(doc, ASSETS));
    const plate = container.querySelector(
      "[data-element-id=logo]",
    ) as HTMLElement;
    expect(plate.style.left).toBe(`${800 - pad}px`);
    expect(plate.style.width).toBe(`${200 + pad * 2}px`);
    const img = plate.querySelector("img") as HTMLImageElement;
    expect(img.style.width).toBe("200px");
  });

  it("limits a button label to the button minus its padding", async () => {
    const doc = (await everyBuilderOutput())[0];
    const button = doc.elements.find((e) => e.type === "button");
    if (button?.type !== "button") throw new Error("no button");
    const { container } = render(documentElement(doc, ASSETS));
    const label = container.querySelector(
      "[data-element-id=cta] > div",
    ) as HTMLElement;
    expect(label.style.maxWidth).toBe(
      `${button.width - buttonPaddingX(button.fontSize) * 2}px`,
    );
  });

  it("maps fonts to the families the caller registered", async () => {
    const doc = (await everyBuilderOutput())[0];
    const { container } = render(
      documentElement(doc, ASSETS, { heading: "BrandHead", body: "BrandBody" }),
    );
    const headline = container.querySelector(
      "[data-element-id=headline] > div",
    ) as HTMLElement;
    expect(headline.style.fontFamily).toBe("BrandHead");
    expect(DEFAULT_FONT_FAMILIES.heading).toBe("Display");
  });
});

describe("textRunStyle", () => {
  const look = {
    font: "body" as const,
    fontSize: 40,
    fontWeight: 400 as const,
    lineHeight: 1.2,
    letterSpacing: 0,
    align: "left" as const,
    italic: false,
    color: "#000000",
  };

  it("breaks an over-long word only on a line several glyphs wide", () => {
    expect(textRunStyle(look).wordBreak).toBe("break-word");
    expect(
      textRunStyle(look, undefined, minBreakableWidth(look)).wordBreak,
    ).toBe("break-word");
    expect(
      textRunStyle(look, undefined, minBreakableWidth(look) - 1).wordBreak,
    ).toBe("normal");
    expect(textRunStyle(look, undefined, 0).wordBreak).toBe("normal");
  });

  it("counts tracking toward the width a glyph takes", () => {
    expect(minBreakableWidth({ fontSize: 40, letterSpacing: 2 })).toBe(200);
    expect(minBreakableWidth({ fontSize: 40, letterSpacing: -0.5 })).toBe(120);
  });
});
