import { describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import { monospaceMeasurer, PALETTE, REALISTIC, specFor } from "../fixtures";
import { documentFromSpec } from "../from-spec";

const build = (headline: string) =>
  documentFromSpec({
    spec: specFor("quote-card", "1:1", { ...REALISTIC, headline }),
    palette: PALETTE,
    canvas: canvasFor("1:1"),
    image: null,
    logo: null,
    measurer: monospaceMeasurer(),
  });

/* Round-3 live critic: a quote mark over copy nobody said, on three of
   eleven directions. */
describe("the quote card's mark", () => {
  it("is drawn over a quotation", async () => {
    for (const headline of [
      "“Best croissant I have had in Lagos”",
      '"Worth the queue" — Ada',
    ]) {
      const { document } = await build(headline);
      expect(
        document.elements.some((e) => e.id === "quote-mark"),
        headline,
      ).toBe(true);
    }
  });

  it("gives way to the accent rule over copy that is not a quotation", async () => {
    const { document } = await build("Fresh croissants, baked before sunrise");
    expect(document.elements.some((e) => e.id === "quote-mark")).toBe(false);
    expect(document.elements.some((e) => e.id === "accent-rule")).toBe(true);
  });
});

/* Round-5 live critic: the regenerated stat card drew a print narrower
   than the card flush against its top border, its rounded corners under
   the straight stroke. */
describe("a print narrower than the stat card", () => {
  const facts = {
    width: 896,
    height: 1120,
    cutout: false,
    ink: { left: 0, top: 0, right: 1, bottom: 1 },
    grid: { cols: 2, rows: 2, rgba: Array(16).fill(128) },
  };
  const subjects = [
    { x: 0.2, y: 0.1, w: 0.6, h: 0.8 },
    { x: 0.3, y: 0.05, w: 0.4, h: 0.9 },
    { x: 0.25, y: 0.2, w: 0.5, h: 0.7 },
  ];

  it("starts a margin below the card's edge, never against it", async () => {
    let narrower = 0;
    for (const ratio of ["4:5", "1:1", "9:16"] as const) {
      for (const subject of subjects) {
        const { document } = await documentFromSpec({
          spec: specFor("stat-highlight", ratio, REALISTIC),
          palette: PALETTE,
          canvas: canvasFor(ratio),
          image: { key: "generated/b1/plates/p.png" },
          imageFacts: facts,
          subject,
          logo: null,
          measurer: monospaceMeasurer(),
        });
        const card = document.elements.find((e) => e.id === "card");
        const image = document.elements.find((e) => e.type === "image");
        if (!card || !image) continue;
        if (image.width >= card.width - 1) continue;
        narrower += 1;
        expect(image.y, `${ratio} ${JSON.stringify(subject)}`).toBeGreaterThan(
          card.y + 1,
        );
      }
    }
    expect(narrower).toBeGreaterThan(0);
  });
});
