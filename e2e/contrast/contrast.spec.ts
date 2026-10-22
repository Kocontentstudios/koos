import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { authState } from "./auth-state";
import {
  failures,
  type Measurement,
  probeInteractive,
  probePage,
  type StateMeasurement,
} from "./probe";

/**
 * Every visible text node on the routes below, in both themes, at rest and in
 * hover, press and keyboard focus on each control: measured against what is
 * actually painted behind it (e2e/contrast/probe.ts), and cross-checked by
 * axe-core's color-contrast rule. A failure names the route, theme, state,
 * element and measured ratio. Evidence lands in test-results/contrast/.
 */

type Who = "anon" | "full" | "welcome" | "start";

const ROUTES: { path: string; who: Who; label: string }[] = [
  { path: "/", who: "anon", label: "landing" },
  { path: "/login", who: "anon", label: "login" },
  { path: "/dashboard", who: "full", label: "dashboard" },
  { path: "/calendar", who: "full", label: "calendar" },
  { path: "/design-studio", who: "full", label: "design-studio" },
  { path: "/strategy", who: "full", label: "strategy" },
  { path: "/brand", who: "full", label: "brand" },
  { path: "/design-request", who: "full", label: "design-tickets" },
  { path: "/dashboard", who: "welcome", label: "onboarding-welcome" },
  { path: "/brand/onboarding", who: "start", label: "onboarding-start" },
];

const THEMES = ["dark", "light"] as const;
const EVIDENCE = path.join("test-results", "contrast");

async function openRoute(
  browser: Browser,
  who: Who,
  theme: (typeof THEMES)[number],
  route: string,
) {
  const context = await browser.newContext({
    storageState:
      who === "anon"
        ? undefined
        : authState(who === "full" ? "full" : `${who}-${theme}`),
    colorScheme: theme,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await context.addInitScript((value) => {
    try {
      localStorage.setItem("koos_theme", value);
    } catch {
      // Storage can be blocked; the colorScheme above still picks the theme.
    }
  }, theme);
  /* The dev server's floating Next.js badge sits over the sidebar's workspace
     avatar; it is not part of the product, so it is not measured. */
  await context.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { display: none !important; }";
      document.head.append(style);
    });
  });
  const page = await context.newPage();
  await page.goto(route, { waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await settle(page);
  return { context, page };
}

/** Scroll once through the page so reveal-on-scroll content is shown, then
 * let entrance animations finish. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    const step = () => new Promise((done) => setTimeout(done, 80));
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await step();
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1500);
}

function report(rows: (Measurement | StateMeasurement)[]) {
  return rows
    .map(
      (m) =>
        `${"state" in m ? m.state : "rest"} ${m.ratio.toFixed(2)}:1 < ${m.required} (${m.method}) "${m.text}" at ${m.where}`,
    )
    .join("\n");
}

for (const { path: route, who, label } of ROUTES) {
  for (const theme of THEMES) {
    test(`${label} (${theme}) has no text below AA contrast`, async ({
      browser,
    }) => {
      const analysis = await browser.newPage();
      const { context, page } = await openRoute(browser, who, theme, route);
      try {
        expect(new URL(page.url()).pathname, "landed on the route").toBe(
          route === "/" ? "/" : route,
        );

        const axe = await new AxeBuilder({ page })
          .withRules(["color-contrast"])
          .analyze();
        const axeViolations = axe.violations.flatMap((v) =>
          v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary}`),
        );

        const rest = await probePage(page, analysis);
        await page.evaluate(() => window.scrollTo(0, 0));
        const { measurements: states, skipped } = await probeInteractive(
          page,
          analysis,
        );

        mkdirSync(EVIDENCE, { recursive: true });
        writeFileSync(
          path.join(EVIDENCE, `${label}-${theme}.json`),
          JSON.stringify(
            {
              route,
              theme,
              measured: { rest: rest.length, states: states.length },
              skipped,
              axeIncomplete: axe.incomplete.flatMap((v) =>
                v.nodes.map((n) => n.target.join(" ")),
              ),
              axeViolations,
              failures: [...failures(rest), ...failures(states)],
              rest,
              states,
            },
            null,
            1,
          ),
        );

        expect(rest.length, "measured text at rest").toBeGreaterThan(0);
        expect(report(failures(rest)), "text at rest").toBe("");
        expect(report(failures(states)), "hover, press and focus").toBe("");
        expect(axeViolations, "axe color-contrast").toEqual([]);
      } finally {
        await context.close();
        await analysis.close();
      }
    });
  }
}
