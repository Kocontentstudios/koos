import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { authState, SEEDED_IDS } from "./auth-state";
import {
  failures,
  load,
  type Measurement,
  probeInteractive,
  probePage,
  probeViewport,
  recordTimeouts,
  releaseTimers,
  type StateMeasurement,
  unreadableContent,
} from "./probe";
import {
  type LaneRoute,
  ROUTES,
  routePath,
  type SeededIds,
  selectedRoutes,
  type Who,
} from "./routes";
import {
  serverErrorsSince,
  serverLogOffset,
  serverRestartedSince,
} from "./server-log";
import { type ExtraViewport, laneViewports } from "./widths";

const EXTRA_VIEWPORTS = laneViewports();

/**
 * Every route in routes.ts, in both themes. Each must first prove it rendered:
 * its sentinel heading is visible, no error boundary is on the page, the
 * browser logged no error and the server logged none while it rendered. Then
 * every visible text run is measured against what is actually painted behind
 * it (probe.ts): at 1440 px at rest and in every state the probe can put a
 * target in, and at rest at one width in every band the breakpoints in src
 * make (widths.ts), the 1280 pass with reduced motion and the phone pass also
 * opening every disclosure. axe-core's color-contrast rule runs
 * alongside. Every target is visited; one the probe could not measure fails
 * the route. Evidence lands in test-results/contrast/.
 */

const THEMES = ["dark", "light"] as const;
type Theme = (typeof THEMES)[number];
const EVIDENCE = path.join("test-results", "contrast");

/* Next's dev overlay logs the first on every page: the CSP is served
   report-only in development, where upgrade-insecure-requests means nothing.
   The second is the probe's own request guard refusing a write while it
   clicks plain buttons (probe.ts); the refused requests are listed in the
   evidence. Neither is the page failing. */
const BENIGN_CONSOLE = [
  /'upgrade-insecure-requests' is ignored when delivered in a report-only policy/,
  /net::ERR_BLOCKED_BY_CLIENT/,
  /* The probe loads a page again after each state that changed it, dozens of
     times a minute; the app's own rate limits (the admin email health check)
     answer that with 429, as they should. */
  /status of 429 \(Too Many Requests\)/,
  /* React's development build records each component render on the
     Performance timeline and throws when a render it timed began before the
     page's time origin (seen intermittently on /admin/analytics). Production
     React records nothing there. */
  /Failed to execute 'measure' on 'Performance': .* cannot have a negative time stamp/,
];

const ERROR_BOUNDARY_TEXT = /Something went wrong/i;

function seededIds(): SeededIds {
  return JSON.parse(readFileSync(SEEDED_IDS, "utf8"));
}

function account(who: Who, theme: Theme) {
  if (who === "anon") return undefined;
  if (who === "welcome" || who === "start") return authState(`${who}-${theme}`);
  return authState(who);
}

interface Opened {
  context: BrowserContext;
  page: Page;
  consoleErrors: string[];
  /** Errors raised while the probe clicked plain buttons with writes
   * refused: evidence, not failures (see probeInteractive). */
  clickErrors: string[];
  /** Third-party assets that failed to load: evidence, not failures. */
  externalErrors: string[];
  clicking: { active: boolean };
}

async function openRoute(
  browser: Browser,
  route: LaneRoute,
  theme: Theme,
  viewport: { width: number; height: number; reducedMotion?: boolean },
): Promise<Opened> {
  const context = await browser.newContext({
    storageState: account(route.who, theme),
    colorScheme: theme,
    reducedMotion: viewport.reducedMotion ? "reduce" : "no-preference",
    viewport: { width: viewport.width, height: viewport.height },
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
  const logStart = serverLogOffset();
  await context.addInitScript(recordTimeouts);
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const clickErrors: string[] = [];
  const externalErrors: string[] = [];
  const clicking = { active: false };
  const logError = (text: string) =>
    (clicking.active ? clickErrors : consoleErrors).push(text);
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (BENIGN_CONSOLE.some((pattern) => pattern.test(text))) return;
    const from = message.location().url;
    /* A third-party asset (Google Fonts) failing on the runner's network is
       the network, not the page; it is kept as evidence. The app's own
       requests failing is the page. */
    if (
      text.startsWith("Failed to load resource") &&
      from &&
      new URL(from).origin !== new URL(page.url()).origin
    ) {
      externalErrors.push(`${text.slice(0, 200)} (${from})`);
      return;
    }
    logError(`${text.slice(0, 400)}${from ? ` (${from})` : ""}`);
  });
  page.on("pageerror", (error) => {
    const text = String(error);
    if (BENIGN_CONSOLE.some((pattern) => pattern.test(text))) return;
    logError(`uncaught: ${text.slice(0, 400)}`);
  });
  await load(page, routePath(route, seededIds()));
  /* A route next dev was still compiling when its chunks were requested
     fails to hydrate with a ChunkLoadError; a second load is served from the
     compiled output. Only that error, only once. */
  if (consoleErrors.some((e) => e.includes("ChunkLoadError"))) {
    consoleErrors.length = 0;
    await load(page, routePath(route, seededIds()));
  }
  /* A load that next dev restarted under (the server log says so) never
     finishes hydrating; it is loaded once more. Without a restart in the
     log, a page that does not hydrate fails here. */
  try {
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  } catch (error) {
    if (!serverRestartedSince(logStart)) throw error;
    /* The half-served load's failed requests are the restart's; they are
       kept as evidence, and the second load's errors count. */
    externalErrors.push(
      ...consoleErrors.splice(0).map((e) => `[server restarted] ${e}`),
    );
    await page.waitForTimeout(10_000);
    await load(page, routePath(route, seededIds()));
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  }
  await assertRendered(page, route);
  await releaseTimers(page);
  await settle(page);
  /* A timeout brought forward can be the page leaving on its own ("taking
     you to your dashboard"). That page is another route's to measure; this
     one is measured as it loads, without its timeouts run. */
  /* The route loaded, but next dev restarted while it did (its own heap
     check, or serve.mjs after V8 ended it): resources the page asked for in
     that window failed. It is loaded once more on the settled server, and
     those failures are kept as evidence. */
  if (serverRestartedSince(logStart)) {
    externalErrors.push(
      ...consoleErrors.splice(0).map((e) => `[server restarted] ${e}`),
    );
    await load(page, routePath(route, seededIds()));
    await assertRendered(page, route);
    await settle(page);
  }
  const expected = routePath(route, seededIds()).split("?")[0];
  if (new URL(page.url()).pathname !== expected) {
    await load(page, routePath(route, seededIds()));
    await assertRendered(page, route);
    await page.waitForTimeout(1500);
  }
  return {
    context,
    page,
    consoleErrors,
    clickErrors,
    externalErrors,
    clicking,
  };
}

/** The page is the route's own, not its error boundary, a redirect or a
 * shell that never finished rendering. */
async function assertRendered(page: Page, route: LaneRoute) {
  const expected = routePath(route, seededIds()).split("?")[0];
  expect(new URL(page.url()).pathname, "landed on the route").toBe(expected);
  await expect(
    page
      .getByRole(route.sentinelRole ?? "heading", { name: route.sentinel })
      .first(),
    `the ${route.label} sentinel ${route.sentinelRole ?? "heading"} "${route.sentinel}"`,
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator("[data-error-boundary]"),
    "error boundary",
  ).toHaveCount(0);
  await expect(page.getByText(ERROR_BOUNDARY_TEXT), "error text").toHaveCount(
    0,
  );
}

/** Scroll once through the page so reveal-on-scroll content is shown, then
 * let entrance animations finish. An IntersectionObserver reports only on a
 * rendered frame, so each step waits in real time. */
async function settle(page: Page) {
  const height = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < height; y += 400) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(80);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await releaseTimers(page);
  await page.waitForTimeout(1500);
}

function report(rows: (Measurement | StateMeasurement)[]) {
  return rows
    .map(
      (m) =>
        `${"state" in m ? `${m.state} of ${m.of}` : "rest"} ${m.ratio.toFixed(2)}:1 < ${m.required} (${m.method}) "${m.text}" at ${m.where}`,
    )
    .join("\n");
}

interface Pass {
  name: string;
  rest: Measurement[];
  states: StateMeasurement[];
  skipped: string[];
  visited: Record<string, number> | null;
  blocked: string[];
  reloads: number;
  seconds: number;
  unreadable: string[];
  consoleErrors: string[];
  clickErrors: string[];
  externalErrors: string[];
  axeViolations: string[];
}

async function measurePass(
  browser: Browser,
  analysis: Page,
  route: LaneRoute,
  theme: Theme,
  viewport: ExtraViewport | null,
): Promise<Pass> {
  const started = Date.now();
  const size = viewport ?? { width: 1440, height: 900, reducedMotion: false };
  const {
    context,
    page,
    consoleErrors,
    clickErrors,
    externalErrors,
    clicking,
  } = await openRoute(browser, route, theme, size);
  try {
    const axe = viewport
      ? { violations: [] }
      : await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
    const unreadable = await unreadableContent(page);
    const rest = await probePage(page, analysis);
    await page.evaluate(() => window.scrollTo(0, 0));
    const interactive =
      viewport === null
        ? await probeInteractive(page, analysis, {
            onClicking: (active) => {
              clicking.active = active;
            },
          })
        : viewport.disclosures
          ? await probeInteractive(page, analysis, { kinds: ["disclosure"] })
          : null;
    /* The probe's guard answers a refused write with a 503, and the browser
       logs that as a failed resource. Any state can send one (Escape on a
       dialog records the dismissal), so the guard's own refusals, matched by
       URL, are its noise, not the page's. */
    const refusedUrls = new Set(
      (interactive?.blocked ?? []).map((b) => b.slice(b.indexOf(" ") + 1)),
    );
    const refused = (error: string) =>
      [...refusedUrls].some((url) => error.endsWith(`(${url})`));
    return {
      name: viewport ? viewport.name : "desktop",
      rest,
      states: interactive?.measurements ?? [],
      skipped: interactive?.skipped ?? [],
      visited: interactive?.visited ?? null,
      blocked: interactive?.blocked ?? [],
      reloads: interactive?.reloads ?? 0,
      seconds: Math.round((Date.now() - started) / 1000),
      unreadable,
      consoleErrors: consoleErrors.filter((e) => !refused(e)),
      clickErrors: [...clickErrors, ...consoleErrors.filter(refused)],
      externalErrors: [...externalErrors],
      axeViolations: axe.violations.flatMap((v) =>
        v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary}`),
      ),
    };
  } finally {
    await context.close();
  }
}

for (const route of selectedRoutes()) {
  for (const theme of THEMES) {
    test(`${route.label} (${theme}) renders and has no text below AA contrast`, async ({
      browser,
    }) => {
      test.setTimeout(45 * 60_000);
      const logStart = serverLogOffset();
      const analysis = await browser.newPage();
      const passes: Pass[] = [];
      try {
        /* The narrower passes run first and only at rest: the full pass
           presses Escape, which dismisses a welcome dialog for good. */
        for (const viewport of EXTRA_VIEWPORTS) {
          const firstVisit = route.who === "welcome" || route.who === "start";
          passes.push(
            await measurePass(
              browser,
              analysis,
              route,
              theme,
              firstVisit ? { ...viewport, disclosures: false } : viewport,
            ),
          );
        }
        passes.push(await measurePass(browser, analysis, route, theme, null));
      } finally {
        await analysis.close();
      }
      const serverErrors = serverErrorsSince(logStart);

      mkdirSync(EVIDENCE, { recursive: true });
      writeFileSync(
        path.join(EVIDENCE, `${route.label}-${theme}.json`),
        JSON.stringify(
          {
            route: route.label,
            theme,
            serverErrors,
            passes: passes.map((p) => ({
              ...p,
              measured: { rest: p.rest.length, states: p.states.length },
              failures: [...failures(p.rest), ...failures(p.states)],
            })),
          },
          null,
          1,
        ),
      );

      expect(serverErrors, "server errors while the route rendered").toEqual(
        [],
      );
      for (const pass of passes) {
        const at = `${pass.name} pass`;
        expect(pass.consoleErrors, `${at}: browser console errors`).toEqual([]);
        expect(pass.unreadable, `${at}: content the probe cannot read`).toEqual(
          [],
        );
        expect(
          pass.rest.length,
          `${at}: measured text at rest`,
        ).toBeGreaterThan(0);
        expect(report(failures(pass.rest)), `${at}: text at rest`).toBe("");
        expect(report(failures(pass.states)), `${at}: text in each state`).toBe(
          "",
        );
        expect(pass.skipped, `${at}: targets that were not measured`).toEqual(
          [],
        );
        expect(pass.axeViolations, `${at}: axe color-contrast`).toEqual([]);
      }
    });
  }
}

/* The shared Button's real loading path, end to end: the login form submits,
   the request is held, and the button is measured while it says "Signing in…",
   at rest and hovered. The probe's loading state sets the same attributes on
   every Button; this proves those are what loading actually sets. */
for (const theme of THEMES) {
  test(`login button while loading (${theme}) keeps its label legible`, async ({
    browser,
  }) => {
    const login = ROUTES.find((r) => r.label === "login") as LaneRoute;
    const analysis = await browser.newPage();
    const { context, page, consoleErrors } = await openRoute(
      browser,
      login,
      theme,
      { width: 1440, height: 900 },
    );
    try {
      let held: { abort: () => Promise<void> } | null = null;
      await page.route("**/login", async (request) => {
        if (request.request().method() === "POST") {
          held = request;
          return;
        }
        await request.continue();
      });
      await page.fill("#email", "e2e-contrast-loading@example.test");
      await page.fill("#password", "not-a-real-password");
      await page.click('button[type="submit"]');
      const button = page.locator('button[type="submit"][data-loading]');
      await expect(button).toHaveText(/Signing in/);
      await expect(button).toHaveAttribute("aria-busy", "true");
      const atRest = await probeViewport(page, analysis, {
        scope: 'button[type="submit"][data-loading]',
        pad: 4,
      });
      const box = await button.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      }
      const hovered = await probeViewport(page, analysis, {
        scope: 'button[type="submit"][data-loading]',
        pad: 4,
      });
      const label = [...atRest, ...hovered].filter((m) =>
        m.text.startsWith("Signing in"),
      );
      expect(label.length, "measured the loading label").toBeGreaterThan(1);
      expect(report(failures([...atRest, ...hovered])), "loading label").toBe(
        "",
      );
      expect(consoleErrors, "browser console errors").toEqual([]);
      await (held as { abort: () => Promise<void> } | null)?.abort();
    } finally {
      await context.close();
      await analysis.close();
    }
  });
}
