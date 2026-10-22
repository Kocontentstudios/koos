import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test support: next/og's fallback faces and emoji, fetched once and kept.
 *
 * For glyphs the bundled faces lack, next/og fetches a Noto face from Google
 * Fonts and Twemoji images from jsDelivr while it renders. Under a suite that
 * saturates every core those fetches time out or reset, and a failure is not
 * neutral: an emoji fetch that fails throws the render, and a face that
 * fails is remembered as missing for the rest of the process, so a probe and
 * the render it sized can draw the same copy in different faces. Here those
 * fetches are retried, and kept on disk between runs, so the tests that use
 * emoji, CJK or RTL copy see the same bytes every time.
 */

const HOSTS = new Set([
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
]);
const CACHE = join(tmpdir(), "koos-og-assets");
const ATTEMPTS = 5;

let installed = false;

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

export function cacheOgAssets(): void {
  if (installed) return;
  installed = true;
  /* Renders run in a worker (render/satori-pool.ts) with its own fetch; it
     reads this when it starts and keeps the same cache. */
  process.env.KOOS_OG_ASSET_CACHE = CACHE;
  const network = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = urlOf(input);
    if (!HOSTS.has(new URL(url).host)) return network(input, init);
    /* Google Fonts answers by User-Agent, and every caller sends one fixed
       User-Agent for a given URL, so the URL alone identifies the
       response. */
    const file = join(CACHE, createHash("sha256").update(url).digest("hex"));
    try {
      return new Response(await readFile(file));
    } catch {
      /* Not cached yet. */
    }
    let failure: unknown = null;
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      try {
        const response = await network(input, init);
        if (response.ok) {
          const body = new Uint8Array(await response.arrayBuffer());
          await mkdir(CACHE, { recursive: true });
          const partial = `${file}.${process.pid}.part`;
          await writeFile(partial, body);
          await rename(partial, file);
          return new Response(body);
        }
        if (response.status < 500) return response;
        failure = new Error(`${url}: HTTP ${response.status}`);
      } catch (error) {
        failure = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
    }
    throw failure;
  };
}
