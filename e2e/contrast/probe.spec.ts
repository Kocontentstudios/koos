import { expect, type Page, test } from "@playwright/test";
import {
  type Measurement,
  probeInteractive,
  probePage,
  recordTimeouts,
  releaseTimers,
  type StateMeasurement,
} from "./probe";

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
  .gen::after { content: "GenBadge"; margin-left: 6px; padding: 0 4px; background: #0ea5e9; color: #fff; }
  .mk::marker { color: #c8d3e0; }
  .grp:hover .ghc { background: #0ea5e9; color: #fff; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .sr:focus { position: static; width: auto; height: auto; clip: auto; background: #0ea5e9; color: #fff; padding: 4px; }
  .chk:has(:checked) .chk-label { background: #0ea5e9; color: #fff; }
  .late:hover { opacity: 0.5; }
  .ld[data-loading] { background: #7dd3fc; }
  .tg:target { background: #0ea5e9; color: #fff; }
  .sel::selection { background: #0ea5e9; color: #fff; }
  .tip { position: fixed; top: 8px; left: 640px; padding: 4px; background: #0ea5e9; color: #fff; }
</style>
<div class="case"><a href="#main" class="sr">SkipLink</a></div>
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
<div class="case"><span class="gen">Host</span></div>
<div class="case"><ol style="padding-left: 48px; margin: 0"><li class="mk">MarkedItem</li></ol></div>
<div class="case" style="position: relative"><span>BehindOklabScrim</span><div style="position: absolute; inset: 0; background: oklab(0.685 -0.0912 -0.1423 / 0.6)"></div></div>
<div class="case"><span style="color: oklch(0.828 0.111 230.318)">OklchText</span></div>
<div class="case" style="position: relative"><span>BehindScrim</span><div style="position: absolute; inset: 0; background: rgba(14, 165, 233, 0.6)"></div></div>
<div class="case"><p style="color: transparent; text-shadow: 0 0 0 #7dd3fc">ShadowPainted</p></div>
<div class="case grp"><span class="ghc">CardHover</span></div>
<div class="case"><details><summary>More</summary><p style="background: #0ea5e9; color: #fff">DetailBody</p></details></div>
<div class="case">
  <button type="button" aria-expanded="false" onclick="this.setAttribute('aria-expanded', String(this.nextElementSibling.hidden)); this.nextElementSibling.hidden = !this.nextElementSibling.hidden">OpenMenu</button>
  <div hidden style="background: #0ea5e9; color: #fff">MenuItem</div>
</div>
<div class="case"><label class="chk"><input type="checkbox"> <span class="chk-label">CheckedLabel</span></label></div>
<div class="case"><button type="button" data-slot="button" class="chip fill ld" style="border: 0">LoadingPale</button></div>
<div class="case"><p id="tgt" class="tg">TargetedRow</p></div>
<div class="case"><p class="sel">SelectedLine</p></div>
<div class="case"><button type="button" id="tipbtn">InfoTip</button></div>
<div class="case" id="later"><span>Syncing</span></div>
<div class="case"><button type="button" onclick="this.nextElementSibling.hidden = false">Reveal</button><div hidden style="background: #0ea5e9; color: #fff">PlainRevealed</div></div>
<div class="case"><button type="button" onclick="fetch('https://example.test/tickets/1/approve', { method: 'POST' }).catch(() => {})">Approve</button></div>
<div class="case" style="display: flex; width: 160px; gap: 8px; overflow-x: auto"><span style="width: 160px; flex-shrink: 0">Scroll strip</span><span class="chip" style="flex-shrink: 0; background: #0ea5e9">StripChip</span></div>
<div class="case" style="height: 32px; overflow-y: auto"><div style="height: 32px">Inner scroller</div><span class="chip" style="background: #0ea5e9">BelowInnerFold</span></div>
<div class="case" id="filler"></div>
<script>
  const tipButton = document.getElementById("tipbtn");
  const showTip = () => {
    if (document.querySelector(".tip")) return;
    const tip = document.createElement("div");
    tip.className = "tip";
    tip.textContent = "PortalTip";
    document.body.append(tip);
  };
  const hideTip = () => document.querySelector(".tip")?.remove();
  tipButton.addEventListener("mouseenter", showTip);
  tipButton.addEventListener("focus", showTip);
  tipButton.addEventListener("mouseleave", hideTip);
  tipButton.addEventListener("blur", hideTip);
  setTimeout(() => {
    document.getElementById("later").innerHTML =
      '<span class="chip" style="background: #0ea5e9">SyncedLate</span>';
  }, 120000);
  const filler = document.getElementById("filler");
  for (let i = 0; i < 125; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "f" + i;
    filler.append(b);
  }
  const late = document.createElement("button");
  late.type = "button";
  late.className = "chip fill late";
  late.style.border = "0";
  late.textContent = "LateFade";
  filler.append(late);
</script>
<div style="height: 2400px"></div>
<div class="case"><span class="chip brand">DeepBelow</span></div>
`;

const FIXTURE_URL = "https://probe.test/cases";

async function measure(page: Page) {
  /* Served from a URL rather than set as content, so the probe can reload
     the page after a click changed it, as it does on a real route. */
  await page.route(FIXTURE_URL, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${CASES}</body></html>`,
    }),
  );
  await page.addInitScript(recordTimeouts);
  await page.goto(FIXTURE_URL);
  await releaseTimers(page);
  const analysis = await page.context().newPage();
  const rest = await probePage(page, analysis);
  await page.evaluate(() => window.scrollTo(0, 0));
  const {
    measurements: states,
    skipped,
    visited,
    blocked,
  } = await probeInteractive(page, analysis);
  await analysis.close();
  const pick = (list: Measurement[], text: string) => {
    const found = list.filter((m) => m.text === text);
    expect(found.length, `measured "${text}"`).toBeGreaterThan(0);
    return Math.min(...found.map((m) => m.ratio));
  };
  const state = (text: string, which: StateMeasurement["state"]) => {
    const found = states.filter((m) => m.text === text && m.state === which);
    expect(found.length, `measured "${text}" in ${which}`).toBeGreaterThan(0);
    return Math.min(...found.map((m) => m.ratio));
  };
  return { rest, states, skipped, visited, blocked, pick, state };
}

test("the probe reads the ground that is painted, not the one declared", async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  const { rest, states, skipped, visited, blocked, pick, state } =
    await measure(page);
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

  /* Round 3's critic found each of these unmeasured (v01, v09, v10, v11,
     v18, v21, v32, v38, v41, v07). Every one is now a measured run. */
  near(pick(rest, "GenBadge"), ratio("#ffffff", "#0ea5e9"));
  near(pick(rest, "1."), ratio("#c8d3e0", "#edf1f7"));
  expect(pick(rest, "BehindScrim")).toBeLessThan(4.5);
  /* Tailwind v4 colours compute to oklab()/oklch(): the zoo's bg-sky-500/60
     scrim was read as no paint at all and the text under it passed. */
  expect(pick(rest, "BehindOklabScrim")).toBeLessThan(4.5);
  near(pick(rest, "OklchText"), ratio("#7dd3fc", "#edf1f7"));
  expect(pick(rest, "ShadowPainted")).toBeLessThan(2);
  near(pick(rest, "DetailBody"), ratio("#ffffff", "#0ea5e9"));
  expect(state("CardHover", "hover")).toBeLessThan(4.5);
  near(state("SkipLink", "focus"), ratio("#ffffff", "#0ea5e9"));
  near(state("MenuItem", "open"), ratio("#ffffff", "#0ea5e9"));
  near(state("CheckedLabel", "checked"), ratio("#ffffff", "#0ea5e9"));
  /* Control 130-odd: past round 3's silent cap of 120. */
  expect(state("LateFade", "hover")).toBeLessThan(4.5);
  expect(visited.control).toBeGreaterThan(125);

  /* Round 3's v12, v13, v26, v27 and v08's portal form: content behind a
     two-minute timer, a loading paint on the shared Button, a :target state,
     a styled ::selection and a tooltip appended to <body>. */
  near(pick(rest, "SyncedLate"), ratio("#ffffff", "#0ea5e9"));
  near(state("LoadingPale", "loading"), ratio("#ffffff", "#7dd3fc"));
  near(state("TargetedRow", "target"), ratio("#ffffff", "#0ea5e9"));
  near(
    Math.min(
      ...rest
        .filter(
          (m) => m.text === "SelectedLine" && m.where.endsWith("[selected]"),
        )
        .map((m) => m.ratio),
    ),
    ratio("#ffffff", "#0ea5e9"),
  );
  expect(
    rest.filter(
      (m) => m.where.endsWith("[selected]") && m.text !== "SelectedLine",
    ),
    "only text with a styled ::selection is measured selected",
  ).toEqual([]);
  /* v03 and v04: text only an inner scroller reveals. */
  near(pick(rest, "StripChip"), ratio("#ffffff", "#0ea5e9"));
  near(pick(rest, "BelowInnerFold"), ratio("#ffffff", "#0ea5e9"));
  /* v11: content a plain button reveals, with no aria-expanded to say so;
     and the click that would write is refused before it leaves the page. */
  near(state("PlainRevealed", "open"), ratio("#ffffff", "#0ea5e9"));
  expect(blocked).toContain("POST https://example.test/tickets/1/approve");
  near(state("PortalTip", "hover"), ratio("#ffffff", "#0ea5e9"));
  near(state("PortalTip", "focus"), ratio("#ffffff", "#0ea5e9"));
});
