import { mkdirSync, writeFileSync } from "node:fs";
import { test as setup } from "@playwright/test";
import { AUTH_DIR, authState, SEEDED_IDS } from "./auth-state";
import { ROUTES, routePath } from "./routes";
import {
  QA_PASSWORD,
  QA_USERS,
  type QaAccount,
  seedContrastAccounts,
} from "./seed";

const LOCAL_DB = "postgres://koos:koos@localhost:5434/koos";

setup("seed and sign in the QA accounts", async ({ browser }) => {
  setup.setTimeout(20 * 60_000);
  const ids = await seedContrastAccounts(
    process.env.E2E_DATABASE_URL ?? LOCAL_DB,
  );
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(SEEDED_IDS, JSON.stringify(ids));
  for (const who of Object.keys(QA_USERS) as QaAccount[]) {
    /* next dev restarts itself when its heap nears --max-old-space-size, and
       a sign-in in flight at that moment never answers: one more try. */
    for (let attempt = 1; ; attempt++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        await page.goto("/login", { waitUntil: "networkidle" });
        await page.fill("#email", QA_USERS[who]);
        await page.fill("#password", QA_PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
          timeout: 60_000,
        });
        await context.storageState({ path: authState(who) });
        break;
      } catch (error) {
        if (attempt >= 3) throw error;
      } finally {
        await context.close();
      }
    }
  }

  /* next dev compiles a route on its first request. Compiling every route
     here, once, keeps that out of the measured runs, where a slow first
     compile surfaced as a ChunkLoadError timeout in the browser. */
  for (const route of ROUTES) {
    /* A first-visit account would see its welcome once and lose it here;
       the full account compiles the same page. */
    const who =
      route.who === "welcome" || route.who === "start" ? "full" : route.who;
    const context = await browser.newContext({
      storageState: who === "anon" ? undefined : authState(who),
    });
    const page = await context.newPage();
    await page
      .goto(routePath(route, ids), { waitUntil: "load", timeout: 180_000 })
      .catch(() => {
        // The measured run reports a route that does not load.
      });
    await context.close();
  }
});
