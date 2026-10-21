import { SUPPORTED_ASPECT_RATIOS } from "@/lib/ai/image/types";
import type { ResolvedPalette } from "@/lib/design/palette";
import { logoPng } from "@/lib/design/render/logo-fixtures";
import { DESIGN_LAYOUTS, type DesignSpec } from "@/lib/design/spec";
import { lineBox, type TextLook, type TextMeasurer } from "./fit";
import type { AssetRef } from "./schema";

/**
 * Shared inputs for the document tests: realistic copy, the schema's
 * worst-case copy, and small generated assets (no binaries in the repo).
 */

export const LAYOUTS = DESIGN_LAYOUTS;
export const RATIOS = SUPPORTED_ASPECT_RATIOS;

export const PALETTE: ResolvedPalette = {
  background: "#FFF4E6",
  foreground: "#3B2416",
  accent: "#C2410C",
};

export const IMAGE: AssetRef = { key: "design-images/b1/photo.png" };
export const LOGO: AssetRef = { key: "logos/b1/mark.png" };
export const LOGO_ASPECT = 4;

export function specFor(
  layout: DesignSpec["layout"],
  aspectRatio: DesignSpec["aspectRatio"],
  copy: Pick<
    DesignSpec,
    "headline" | "subheadline" | "cta" | "footerStyle" | "footerLines"
  > = REALISTIC,
): DesignSpec {
  return {
    layout,
    ...copy,
    palette: PALETTE,
    logoPlacement:
      layout === "quote-card" || layout === "stat-highlight"
        ? "top-right"
        : layout === "banner-bottom"
          ? "top-left"
          : "top-right",
    logoFree: false,
    logoFreeQuote: "",
    backgroundPrompt: "unused",
    backgroundTreatment: "photographic",
    nativePrompt: "unused",
    aspectRatio,
  };
}

export const REALISTIC = {
  headline: "Fresh croissants, baked before sunrise",
  subheadline:
    "Flaky, buttery and still warm. Come in early for the first batch of the day.",
  cta: "Order for pickup",
  footerStyle: "text" as const,
  footerLines: ["12 Admiralty Way, Lekki · Open daily 7am to 6pm"],
};

/** At the schema's limits: 70, 140 and 32 characters, three 60-character
 *  footer lines. */
export const WORST_CASE = {
  headline:
    "Our Christmas pre-order window closes Friday: reserve croissants now!!",
  subheadline:
    "Butter croissants, almond twice-baked, pain au chocolat and our seasonal panettone, all baked fresh at dawn, and boxed ready for collection.",
  cta: "Reserve your Christmas box today",
  footerStyle: "bar" as const,
  footerLines: [
    "12 Admiralty Way, Lekki Phase 1, Lagos · Mon-Sun 7am to 6pm.",
    "Call or WhatsApp 0803 555 0142 · hello@crumbandco.ng anytime",
    "Pre-orders close 20 December · Collect 23 or 24 Dec, 8am-1pm",
  ],
};

if (
  WORST_CASE.headline.length !== 70 ||
  WORST_CASE.subheadline.length !== 140 ||
  WORST_CASE.cta.length !== 32 ||
  WORST_CASE.footerLines.some((line) => line.length !== 60)
) {
  throw new Error("WORST_CASE copy must sit exactly at the schema limits");
}

/** A 4:1 mark and a small photo-like image, as real PNG bytes. */
export function testAssets() {
  return {
    [LOGO.key]: {
      bytes: logoPng({
        width: 200,
        height: 50,
        color: [59, 36, 22, 255],
        shape: "block",
      }),
      contentType: "image/png",
    },
    [IMAGE.key]: {
      bytes: logoPng({
        width: 96,
        height: 64,
        color: [200, 160, 120, 255],
        shape: "block",
      }),
      contentType: "image/png",
    },
  };
}

/**
 * A monospaced stand-in for satori: every character advances 0.5em and lines
 * break greedily at spaces. Exact and instant, so the search logic can be
 * tested on its own; measure.smoke.test.tsx covers the real measurer.
 */
export function monospaceMeasurer(): TextMeasurer & { calls: number } {
  const advance = (look: TextLook) => look.fontSize * 0.5;
  const self = {
    calls: 0,
    async height(text: string, look: TextLook, width: number) {
      self.calls += 1;
      const perLine = Math.max(1, Math.floor(width / advance(look)));
      let lines = 1;
      let used = 0;
      for (const word of text.split(/\s+/).filter(Boolean)) {
        const needed = used === 0 ? word.length : used + 1 + word.length;
        if (needed > perLine && used > 0) {
          lines += 1;
          used = word.length;
        } else {
          used = needed;
        }
      }
      return lines * lineBox(look);
    },
    async lineWidth(text: string, look: TextLook) {
      self.calls += 1;
      return Math.ceil(text.length * advance(look));
    },
    async widestWord(text: string, look: TextLook) {
      self.calls += 1;
      const longest = Math.max(
        0,
        ...text.split(/\s+/).map((word) => word.length),
      );
      return Math.ceil(longest * advance(look));
    },
  };
  return self;
}
