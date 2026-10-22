import { expect, type Page, test } from "@playwright/test";
import { type Measurement, probeInteractive, probePage } from "./probe";

/**
 * The probe against pairs whose ratio is known. Static markup, no server: if
 * this lane is green and the probe stops seeing a kind of ground, this file is
 * where it shows. Each case is one labelled element, found by its text.
 */

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel(n >> 16) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const CASES = `
<style>
  body { margin: 0; background: #edf1f7; color: #0f172a; font: 16px/1.5 sans-serif; }
  .case { margin: 24px; }
  .chip { display: inline-block; padding: 4px 10px; color: #fff; }
  .fill { background: #1075a8; }
  .brand { background: #138bc8; }
  .before { position: relative; isolation: isolate; }
  .before::before { content: ""; position: absolute; inset: 0; z-index: -1; background: #138bc8; }
  .fade:hover { opacity: 0.7; }
  input::placeholder, textarea::placeholder { color: #9aa5b1; }
</style>
<div class="case"><span class="chip fill">FillToken</span></div>
<div class="case"><span class="chip brand">BrandFill</span></div>
<div class="case" style="opacity: 0.7"><span class="chip fill">FadedAncestor</span></div>
<div class="case"><span class="chip" style="background: linear-gradient(90deg, #1075a8, #6cc3f0)">GradientRamp</span></div>
<div class="case"><span class="chip before">BeforeBox</span></div>
<div class="case"><svg width="160" height="40"><rect width="160" height="40" fill="#138bc8"/><text x="8" y="26" fill="#ffffff">SvgLabel</text></svg></div>
<div class="case"><span class="chip fill" style="color: #0f172a">InheritedDark</span></div>
<div class="case"><span style="color: #edf1f7">SameAsPage</span></div>
<div class="case"><span>PlainBody</span></div>
<div class="case"><input aria-label="Name" placeholder="PlaceholderHint" style="font-size: 16px; padding: 8px; background: #ffffff; border: 1px solid #ccc"></div>
<div class="case"><textarea aria-label="Message" rows="4" placeholder="TextareaHint" style="font-size: 16px; padding: 8px; background: #ffffff; border: 1px solid #ccc"></textarea></div>
<div class="case"><button type="button" class="chip fill fade" style="border: 0; font-size: 16px">HoverFade</button></div>
<div class="case"><span class="chip fill" style="filter: brightness(1.5)">BrightFilter</span></div>
<div class="case"><span class="chip fill" style="mix-blend-mode: screen">BlendScreen</span></div>
<div class="case"><span class="chip" style="box-shadow: inset 0 0 0 999px #138bc8">InsetShadow</span></div>
<div class="case"><table><tr><td bgcolor="#138bc8"><font color="#ffffff">LegacyBgcolor</font></td></tr></table></div>
<div style="height: 2400px"></div>
<div class="case"><span class="chip brand">DeepBelow</span></div>
`;

async function measure(page: Page) {
  await page.setContent(CASES);
  const analysis = await page.context().newPage();
  const rest = await probePage(page, analysis);
  await page.evaluate(() => window.scrollTo(0, 0));
  const { measurements: states, skipped } = await probeInteractive(
    page,
    analysis,
  );
  await analysis.close();
  const pick = (list: Measurement[], text: string) => {
    const found = list.filter((m) => m.text === text);
    expect(found.length, `measured "${text}"`).toBeGreaterThan(0);
    return Math.min(...found.map((m) => m.ratio));
  };
  return { rest, states, skipped, pick };
}

test("the probe reads the ground that is painted, not the one declared", async ({
  page,
}) => {
  const { rest, states, skipped, pick } = await measure(page);
  const near = (actual: number, expected: number) =>
    expect(actual).toBeCloseTo(expected, 1);

  near(pick(rest, "FillToken"), ratio("#ffffff", "#1075a8"));
  near(pick(rest, "BrandFill"), ratio("#ffffff", "#138bc8"));
  near(pick(rest, "BeforeBox"), ratio("#ffffff", "#138bc8"));
  near(pick(rest, "SvgLabel"), ratio("#ffffff", "#138bc8"));
  near(pick(rest, "InheritedDark"), ratio("#0f172a", "#1075a8"));
  near(pick(rest, "PlainBody"), ratio("#0f172a", "#edf1f7"));
  near(pick(rest, "PlaceholderHint"), ratio("#9aa5b1", "#ffffff"));
  near(pick(rest, "TextareaHint"), ratio("#9aa5b1", "#ffffff"));
  near(pick(rest, "DeepBelow"), ratio("#ffffff", "#138bc8"));
  expect(pick(rest, "SameAsPage")).toBeLessThan(1.1);

  /* 0.7 over the page lifts the fill to about #4b98c0 under #b3b6bc-ish
     white: well under AA, and not the 5.08 the token alone would give. */
  expect(pick(rest, "FadedAncestor")).toBeLessThan(3.5);
  /* The ramp ends on #6cc3f0, where white is 2.11:1. */
  expect(pick(rest, "GradientRamp")).toBeLessThan(
    ratio("#ffffff", "#6cc3f0") + 0.2,
  );

  /* The grounds axe-core reports as incomplete or never sees: a filter or a
     blend mode repaints the fill after layout, a shadow is not a background,
     and bgcolor is markup, not CSS. */
  expect(pick(rest, "BrightFilter")).toBeLessThan(4.5);
  expect(pick(rest, "BlendScreen")).toBeLessThan(2);
  near(pick(rest, "InsetShadow"), ratio("#ffffff", "#138bc8"));
  near(pick(rest, "LegacyBgcolor"), ratio("#ffffff", "#138bc8"));

  near(pick(rest, "HoverFade"), ratio("#ffffff", "#1075a8"));
  const hovered = states.filter(
    (m) => m.text === "HoverFade" && m.state === "hover",
  );
  expect(hovered.length).toBe(1);
  expect(hovered[0].ratio).toBeLessThan(4.5);
  const focused = states.filter(
    (m) => m.text === "HoverFade" && m.state === "focus",
  );
  near(focused[0].ratio, ratio("#ffffff", "#1075a8"));
  expect(skipped).toEqual([]);
});
