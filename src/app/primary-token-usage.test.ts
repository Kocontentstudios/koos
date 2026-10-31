// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appScanPolicy } from "@/lib/theme/primary-policy";
import { scanPrimaryUsage } from "@/lib/theme/primary-usage";

/**
 * The brand blue --primary (#138bc8) fails as a fill behind a white label
 * (3.78:1) and as text on the app's surfaces (down to 3.34:1). The fix is a
 * token split: --primary-fill* under labels, --primary-text* for the blue as
 * text, --primary only for rings, borders, dots and bars. theme-contrast.test.ts
 * measures the tokens; this file makes every other pairing unwritable. How the
 * scan reads source, and the evasions it was built against, are in
 * src/lib/theme/primary-usage.ts and its test.
 */

const SRC = path.join(process.cwd(), "src");
/* Every source extension src/ can hold: round 2's walk read only .ts, .tsx
   and .css, so a fill pair in a .jsx or .mts file passed the gate. */
const SCANNED = /\.(?:[cm]?[jt]sx?|css)$/;

describe("src pairs no label with the brand blue outside the fill and text tokens", () => {
  it("has no misuse of the primary family anywhere", () => {
    const policy = appScanPolicy();
    const problems: string[] = [];
    for (const entry of readdirSync(SRC, { recursive: true })) {
      const rel = String(entry);
      if (!SCANNED.test(rel) || /\.test\.[cm]?[jt]sx?$/.test(rel)) continue;
      const source = readFileSync(path.join(SRC, rel), "utf8");
      problems.push(...scanPrimaryUsage(`src/${rel}`, source, policy));
    }
    expect(problems).toEqual([]);
  });
});
