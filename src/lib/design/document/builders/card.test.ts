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
