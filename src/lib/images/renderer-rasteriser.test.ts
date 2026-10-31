// @vitest-environment node
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import packageJson from "../../../package.json";

/**
 * next/og (@vercel/og) rasterises with sharp, so librsvg and libxml2, when
 * `await import("sharp")` succeeds from inside it, and silently falls back to
 * resvg-wasm when it does not. The byte budget in reencode.ts and every
 * render gate are measured against the sharp path, so a deploy where sharp
 * stopped resolving would be running a renderer nothing here has tested
 * (round-3 critic C5). This fails first.
 */

const require = createRequire(import.meta.url);
const OG_ENTRY = "next/dist/compiled/@vercel/og/index.node.js";

describe("the rasteriser next/og uses", () => {
  /* The native binding loads too, not just the JavaScript: a missing
     platform binary is the likeliest way the import fails in a lambda. */
  it("is sharp, resolved and loaded from where @vercel/og imports it", async () => {
    const fromOg = createRequire(require.resolve(OG_ENTRY));
    const resolved = fromOg.resolve("sharp");
    const sharp = (await import(pathToFileURL(resolved).href)).default;
    expect(typeof sharp).toBe("function");
    expect(sharp.versions.rsvg).toMatch(/^\d+\.\d+/);
    expect(sharp.versions.xml2).toMatch(/^\d+\.\d+/);
    expect(sharp.versions.sharp).toBe(packageJson.dependencies.sharp);
  });

  it("still takes the sharp branch in @vercel/og", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(require.resolve(OG_ENTRY), "utf8");
    expect(source).toContain('await import("sharp")');
    expect(source).toMatch(/if \(sharp\) \{\s*pngBuffer = await sharp\(/);
  });
});
