// @vitest-environment node
import { describe, expect, it } from "vitest";
import { IMAGE_NOT_USABLE_PREFIX } from "@/lib/uploads/design-image-limits";
import { svgAttackCorpus } from "./svg-attack-fixtures";
import { SVG_DRAWS_NOTHING_MESSAGE, svgDrawsSomething } from "./svg-drawable";
import { type SafeSvg, sanitizeSvg, UnsafeSvgError } from "./svg-sanitize";

const NS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"';
const draws = async (svg: string) =>
  svgDrawsSomething(await sanitizeSvg(new TextEncoder().encode(svg)));

/* Round-6 review, L1. */
describe("svgDrawsSomething", () => {
  it.each([
    ["an empty root", `<svg ${NS}/>`],
    [
      "HTML in a foreignObject",
      `<svg ${NS}><foreignObject width="10" height="10"><p xmlns="http://www.w3.org/1999/xhtml">Acme</p></foreignObject></svg>`,
    ],
    [
      "an image under a foreign default namespace",
      `<svg ${NS}><g xmlns="urn:x"><image href="http://x.test/a.png"/></g></svg>`,
    ],
    [
      "shapes only inside definitions",
      `<svg ${NS}><defs><rect id="r" width="5" height="5"/></defs><clipPath id="c"><circle r="3"/></clipPath><symbol id="s"><path d="M0 0h5v5z"/></symbol></svg>`,
    ],
    [
      "empty groups and a title",
      `<svg ${NS}><title>Acme</title><g><g/></g></svg>`,
    ],
    ["a text element with only spaces", `<svg ${NS}><text>  \n </text></svg>`],
    [
      "text only in a style block",
      `<svg ${NS}><style>.a{fill:red}</style><desc>logo</desc></svg>`,
    ],
  ])("is false for %s", async (_label, svg) => {
    expect(await draws(svg)).toBe(false);
  });

  it.each([
    ["a rect", `<svg ${NS}><rect width="5" height="5"/></svg>`],
    [
      "a path in a group",
      `<svg ${NS}><g><g><path d="M0 0h5v5z"/></g></g></svg>`,
    ],
    [
      "a use of a symbol",
      `<svg ${NS}><symbol id="s"><circle r="3"/></symbol><use href="#s"/></svg>`,
    ],
    ["text", `<svg ${NS}><text y="8">Acme</text></svg>`],
    ["text in a tspan", `<svg ${NS}><text><tspan>A</tspan></text></svg>`],
    [
      "a shape beside a foreignObject",
      `<svg ${NS}><foreignObject><p xmlns="http://www.w3.org/1999/xhtml">x</p></foreignObject><circle r="2"/></svg>`,
    ],
    [
      "a prefixed SVG root",
      `<s:svg xmlns:s="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><s:rect width="5" height="5"/></s:svg>`,
    ],
  ])("is true for %s", async (_label, svg) => {
    expect(await draws(svg)).toBe(true);
  });

  /* Never refuses a file the logo path draws. */
  it("is true for every file in the attack corpus the logo path draws", async () => {
    const missed: string[] = [];
    for (const { name, bytes, expect: want } of await svgAttackCorpus()) {
      if (want !== "drawn") continue;
      let safe: SafeSvg;
      try {
        safe = await sanitizeSvg(bytes);
      } catch (err) {
        if (err instanceof UnsafeSvgError) continue;
        throw err;
      }
      if (!svgDrawsSomething(safe)) missed.push(name);
    }
    expect(missed).toEqual([]);
  }, 60_000);

  it("tells the uploader in the shared unusable-image words", () => {
    expect(SVG_DRAWS_NOTHING_MESSAGE).toMatch(
      new RegExp(`^${IMAGE_NOT_USABLE_PREFIX}: \\S`),
    );
  });
});
