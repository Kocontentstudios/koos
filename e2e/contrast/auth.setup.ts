import { mkdirSync } from "node:fs";
import { test as setup } from "@playwright/test";
import { AUTH_DIR, authState } from "./auth-state";
import {
  QA_PASSWORD,
  QA_USERS,
  type QaAccount,
  seedContrastAccounts,
} from "./seed";

const LOCAL_DB = "postgres://koos:koos@localhost:5434/koos";

setup("seed and sign in the QA accounts", async ({ browser }) => {
  setup.setTimeout(5 * 60_000);
  await seedContrastAccounts(process.env.E2E_DATABASE_URL ?? LOCAL_DB);
  mkdirSync(AUTH_DIR, { recursive: true });
  for (const who of Object.keys(QA_USERS) as QaAccount[]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.fill("#email", QA_USERS[who]);
    await page.fill("#password", QA_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 120_000,
    });
    await context.storageState({ path: authState(who) });
    await context.close();
  }
});
