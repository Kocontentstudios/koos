// @vitest-environment node
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import type { DesignSpec } from "@/lib/design/spec";
import { photoPlace } from "@/lib/jobs/directions/render";
import type { ImageFacts } from "./builders/ground";
import { specFor } from "./fixtures";
import { documentFromSpec } from "./from-spec";
import { measureImage } from "./image-facts";
import { createRendererMeasurer, type RendererMeasurer } from "./measure";
import { measureSubject, type SubjectBox } from "./subject";
import { TEST_PROBE_LIMIT_MS } from "./testing-measure";

/*
 * Round 25, CI gap (round-10 live verdict): round24.smoke's traced-cafe
 * test guards the widened beside panel (hero-center BESIDE_SHARES), but it
 * reads the stock photo from /tmp and skips in CI. The fix is geometry and
 * real-font text size, not pixels, so a photo of the stock photo's size
 * (5242 x 3744, drawn at 900 wide) made here exercises it. Real fonts: the
 * job harness's monospace stub fits the photo-above band and hides it.
 */

const KEY = { key: "design-images/b1/round25-cafe.jpg" };
const STOCK_CAFE = { width: 5242, height: 3744 };

const TRACED: { subject: SubjectBox; heads: SubjectBox[] } = {
  subject: { x: 0.16, y: 0.26, w: 0.64, h: 0.61 },
  heads: [
    { x: 0.58, y: 0.16, w: 0.19, h: 0.24 },
    { x: 0.69, y: 0.11, w: 0.24, h: 0.33 },
  ],
};

const LIVE_S1: Pick<
  DesignSpec,
  "headline" | "subheadline" | "cta" | "footerStyle" | "footerLines"
> = {
  headline: "Three Tasters. ₦6,000.",
  subheadline:
    "A cold brew flight — three 150ml tasters for ₦6,000, or go long with the 1-litre bottle.",
  cta: "Ask for oat milk",
  footerStyle: "text",
  footerLines: [
    "Bottle and two glasses ₦15,500",
    "Weekdays 8am to 6pm",
    "9 Akinola Street, Yaba",
  ],
};

let measurer: RendererMeasurer;
let facts: ImageFacts;

/** A mid-toned bar scene stand-in: a warm gradient with a lighter band
 *  where the counter is, so the veil is measured on varied pixels. */
async function syntheticCafe(): Promise<Uint8Array> {
  const width = 900;
  const height = Math.round((width * STOCK_CAFE.height) / STOCK_CAFE.width);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6b625a"/><stop offset="1" stop-color="#3f3832"/>
    </linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect x="${width * 0.16}" y="${height * 0.5}" width="${width * 0.64}" height="${height * 0.3}" fill="#c9c2b6"/>
  </svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).jpeg().toBuffer());
}

beforeAll(async () => {
  const fonts = await loadBrandFonts(null);
  measurer = createRendererMeasurer({
    probeLimitMs: TEST_PROBE_LIMIT_MS,
    fonts,
  });
  const measured = await measureImage({
    bytes: await syntheticCafe(),
    contentType: "image/jpeg",
  });
  if (!measured) throw new Error("synthetic cafe did not measure");
  facts = measured;
}, 60_000);

describe("round 25: hero-center on the traced cafe look, CI-safe", () => {
  it("shows the bar whole beside the copy, its heads whole, nothing on it", async () => {
    for (const look of [
      TRACED,
      { ...TRACED, subject: { ...TRACED.subject, w: 0.6 } },
    ]) {
      const spec = {
        ...specFor("hero-center", "1:1", LIVE_S1),
        logoPlacement: "none" as const,
      };
      const { document, subjectFault } = await documentFromSpec({
        spec,
        palette: spec.palette as never,
        canvas: canvasFor("1:1"),
        image: KEY,
        imageFacts: facts,
        subject: look.subject,
        heads: look.heads,
        logo: null,
        measurer,
      });
      const label = JSON.stringify(look.subject);
      expect(subjectFault, label).toBeNull();
      expect(
        measureSubject(document, facts, look.subject, look.heads)?.ok,
        label,
      ).toBe(true);
      expect(photoPlace(document)?.arrangement, label).toBe("beside");
    }
  }, 60_000);
});
