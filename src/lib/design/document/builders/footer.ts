import {
  footerBandHeight,
  footerLinesFor,
  hasFooter,
} from "@/lib/design/render/footer";
import { fitText, inkOverhang, lineBox, wrapWidth } from "../fit";
import type { DesignElement, TextElement } from "../schema";
import {
  COPY_WORD_BROKEN,
  type Context,
  px,
  shapeElement,
  textElement,
} from "./context";
import { LEGIBLE_FLOOR, looks, roleSizes } from "./looks";

/**
 * Utility lines along the bottom, in the band the flex footer takes
 * (render/footer.ts footerBandHeight).
 *
 * A bar is its own ground and runs to the bottom edge, as in flex. Plain
 * text sits on the design, lifted off the edge by a safe margin: the flex
 * footer's descenders sat 5-7px from the edge, where a platform's own UI
 * covers them.
 */

export interface Footer {
  elements: DesignElement[];
  /** Top edge of whatever the footer occupies; copy must end above it. */
  top: number;
  /** The rectangle the footer's text sits in, for measuring its ground. */
  textBox: { x: number; y: number; width: number; height: number };
}

/** Distance from the bottom edge to a plain-text footer's band. */
function safeBottom(ctx: Context): number {
  return px(ctx.ref * 0.04);
}

export async function footer(
  ctx: Context,
  options: {
    band: { x: number; width: number };
    align: "left" | "center";
    color: string;
  },
): Promise<Footer | null> {
  const { spec, ref, height, width, measurer, palette, margin } = ctx;
  if (!hasFooter(spec)) return null;
  const lines = footerLinesFor(spec).map(keepSeparatorsWithPrecedingWord);
  const isBar = spec.footerStyle === "bar";
  const textAlign = options.align === "center" ? "center" : "left";
  const band = isBar ? { x: margin, width: width - margin * 2 } : options.band;
  const color = isBar ? palette.background : options.color;
  const lineGap = px(ref * 0.006);
  const bandHeight = px(footerBandHeight(spec, { width, height }));
  const sizes = roleSizes(ref, "footer");

  const fitted = [];
  for (const line of lines) {
    fitted.push(
      await fitText(measurer, {
        text: line,
        look: (size) => looks.footer(size, textAlign),
        width: band.width,
        maxHeight: lineBox(looks.footer(sizes[0], textAlign)) * 2,
        sizes,
        floor: Math.round(ref * LEGIBLE_FLOOR),
        maxLines: 1,
      }),
    );
  }
  if (fitted.some((f) => f.breaksWords)) ctx.faults.add(COPY_WORD_BROKEN);
  /* One size for every line, the smallest any of them needed: a footer whose
     lines are set at different sizes reads as a mistake. */
  const fontSize = Math.min(...fitted.map((f) => f.fontSize));
  const look = looks.footer(fontSize, textAlign);
  const heights = await Promise.all(
    lines.map((line) => measurer.height(line, look, wrapWidth(band.width))),
  );
  const content =
    heights.reduce((sum, h) => sum + h, 0) + lineGap * (lines.length - 1);

  /* The band is the flex band, grown only when its lines need more room than
     it gives, so a long footer moves the copy up rather than overflowing. */
  const minPad = px(ref * 0.024);
  const barHeight = Math.max(bandHeight, content + minPad * 2);
  const textBand = Math.max(bandHeight, content);
  const bandTop = isBar
    ? height - barHeight
    : height - safeBottom(ctx) - textBand;
  const textTop = isBar
    ? bandTop + (barHeight - content) / 2
    : bandTop + (textBand - content) / 2;

  const elements: DesignElement[] = [];
  if (isBar) {
    elements.push(
      shapeElement(
        "footer-bar",
        "Footer bar",
        { x: 0, y: bandTop, width, height: barHeight },
        palette.foreground,
      ),
    );
  }
  const inks = await Promise.all(
    lines.map((line) => inkOverhang(measurer, line, look)),
  );
  let y = px(textTop);
  lines.forEach((line, index) => {
    elements.push(
      textElement(
        `footer-${index + 1}`,
        `Footer line ${index + 1}`,
        "footer",
        line,
        look,
        color,
        { x: band.x, y, width: band.width, height: heights[index] },
        inks[index],
      ),
    );
    y += heights[index] + lineGap;
  });
  return {
    elements,
    top: px(bandTop),
    textBox: { x: band.x, y: px(textTop), width: band.width, height: content },
  };
}

/** The footer with its plain text recoloured, for when the ground under it is
 *  only known once the rest of the layout is placed. A bar keeps its own. */
export function recolorFooter(foot: Footer, color: string): Footer {
  return {
    ...foot,
    elements: foot.elements.map((element) =>
      element.type === "text" && !foot.elements.some((e) => e.type === "shape")
        ? ({ ...element, color } satisfies TextElement)
        : element,
    ),
  };
}

/* A footer line that has to wrap must not start its second line with the
   separator: "Lekki / · Open daily" reads as a typo. A no-break space before
   the separator ties it to the word it follows. */
function keepSeparatorsWithPrecedingWord(line: string): string {
  return line.replace(/ ([·|•–—]) /g, "\u00A0$1 ");
}
