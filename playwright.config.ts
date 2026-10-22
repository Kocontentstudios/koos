import { defineConfig, devices } from "@playwright/test";

/**
 * The e2e lane: real routes in a real browser, against a local dev server and
 * the local database. Not part of the <2s gate; see e2e/README.md.
 */

const PORT = Number(process.env.E2E_PORT ?? 3417);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
const LOCAL_DB = "postgres://koos:koos@localhost:5434/koos";
const browser = {
  ...devices["Desktop Chrome"],
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
};

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results/e2e",
  timeout: 10 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: true,
  workers: Number(process.env.E2E_WORKERS ?? 3),
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/e2e/report.json" }],
  ],
  use: { baseURL },
  projects: [
    /* The probe measuring known pairs on static markup: no server, no DB. */
    { name: "probe", testMatch: /probe\.spec\.ts$/, use: browser },
    { name: "setup", testMatch: /\.setup\.ts$/, use: browser },
    {
      name: "contrast",
      testMatch: /contrast\.spec\.ts$/,
      dependencies: ["setup"],
      use: browser,
    },
  ],
  webServer:
    process.env.E2E_BASE_URL || process.env.E2E_NO_SERVER
      ? undefined
      : {
          command: `corepack pnpm exec next dev --port ${PORT}`,
          url: `${baseURL}/login`,
          reuseExistingServer: true,
          timeout: 180_000,
          env: {
            DATABASE_URL: process.env.E2E_DATABASE_URL ?? LOCAL_DB,
            DIRECT_URL: process.env.E2E_DATABASE_URL ?? LOCAL_DB,
            NEXT_PUBLIC_APP_URL: baseURL,
          },
        },
});
