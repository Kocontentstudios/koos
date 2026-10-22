import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NOT_RENDERED, ROUTES } from "../../e2e/contrast/routes";

/**
 * The rendered contrast lane measures only the routes it opens. Round 3's
 * lane never visited /team, /settings, /admin/* or /design-request/[id], so a
 * sub-AA badge on /team passed every check. This makes the route list
 * exhaustive: every page in src/app is rendered by the lane or named in
 * NOT_RENDERED with a reason.
 */
const APP = path.join(process.cwd(), "src", "app");

const pages = readdirSync(APP, { recursive: true })
  .map(String)
  .filter((file) => file.endsWith(`${path.sep}page.tsx`) || file === "page.tsx")
  .map((file) => file.split(path.sep).join("/"))
  .sort();

describe("the contrast lane renders every page", () => {
  it("lists each page.tsx as a route or as not rendered, with a reason", () => {
    const covered = new Set([
      ...ROUTES.map((r) => r.file),
      ...Object.keys(NOT_RENDERED),
    ]);
    expect(pages.filter((file) => !covered.has(file))).toEqual([]);
  });

  it("names only pages that exist", () => {
    const stale = [
      ...ROUTES.map((r) => r.file),
      ...Object.keys(NOT_RENDERED),
    ].filter((file) => !pages.includes(file));
    expect(stale).toEqual([]);
  });

  it("gives every route a sentinel and a unique label", () => {
    const labels = ROUTES.map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const route of ROUTES) expect(route.sentinel.trim()).not.toBe("");
    for (const reason of Object.values(NOT_RENDERED)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});

/* The spec says the lane runs on every pull request that can change a pixel
   and nightly. That is only true while the workflow says so. */
describe("the contrast workflow runs the lane", () => {
  const workflow = readFileSync(
    path.join(process.cwd(), ".github", "workflows", "contrast.yml"),
    "utf8",
  );

  it.each([
    "src/app/**",
    "src/components/**",
    "docs/KO_OS UI.Specification.md",
    "e2e/**",
  ])("on pull requests that touch %s", (glob) => {
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain(`"${glob}"`);
  });

  it("nightly, against a postgres service, through pnpm e2e:contrast", () => {
    expect(workflow).toMatch(/schedule:\s*\n\s*- cron:/);
    expect(workflow).toMatch(/services:\s*\n\s*postgres:/);
    expect(workflow).toContain("node scripts/migrate.mjs");
    expect(workflow).toContain("run: pnpm e2e:contrast");
  });

  it("runs every lane project", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    );
    expect(pkg.scripts["e2e:contrast"]).toBe(
      "playwright test --project=probe --project=contrast --project=server-log",
    );
  });
});
