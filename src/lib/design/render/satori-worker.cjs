/**
 * The satori + resvg worker behind satori-pool.ts.
 *
 * Plain CommonJS on purpose: it is started from a file path at run time, so
 * it must not need the bundler or a TypeScript loader. It receives an
 * element tree already reduced to plain objects, the faces it has not seen
 * yet, and answers with PNG bytes or an error message.
 */
const { parentPort } = require("node:worker_threads");
const { createHash } = require("node:crypto");
const { mkdir, readFile, rename, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const { ImageResponse } = require(
  require.resolve("next/og", { paths: [process.cwd(), __dirname] }),
);

/* Faces arrive once per worker and are kept by id. One options array per
   face set, reused, because satori caches parsed faces per array. */
const faces = new Map();
const faceSets = new Map();

function fontOptions(fonts) {
  if (fonts.length === 0) return undefined;
  const key = fonts.map((font) => font.id).join(",");
  let set = faceSets.get(key);
  if (!set) {
    set = fonts.map((font) => {
      if (font.data) faces.set(font.id, font.data);
      return {
        name: font.name,
        data: faces.get(font.id),
        weight: font.weight,
        style: font.style,
      };
    });
    faceSets.set(key, set);
  } else {
    for (const font of fonts) if (font.data) faces.set(font.id, font.data);
  }
  return set;
}

/* next/og fetches fallback faces from Google Fonts and every emoji from
   jsDelivr while it renders, all at once, and one failed fetch throws the
   whole render. Transient failures are retried. Emoji are also kept on
   disk, so a worker started after a timeout, or the next instance, does
   not wait on the CDN again for a picture it has drawn before. The first
   fetch from a fresh process costs its handshakes: the worst document drew
   in 3.7-4.4s cold against 1.5-2.1s once connected. Google's answers are
   subsets keyed by the exact text, so they are kept only where tests ask
   for it (testing-og-assets.ts sets KOOS_OG_ASSET_CACHE), never growing
   on a server. */
const OG_HOSTS = new Set([
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
]);
const EMOJI_HOST = "cdn.jsdelivr.net";
const ATTEMPTS = 3;
const testCache = process.env.KOOS_OG_ASSET_CACHE;
const emojiCache = join(tmpdir(), "koos-og-emoji");

async function fromCache(file) {
  try {
    return new Response(await readFile(file));
  } catch {
    return null;
  }
}

async function intoCache(dir, file, body) {
  try {
    await mkdir(dir, { recursive: true });
    const partial = `${file}.${process.pid}.${Math.random()}.part`;
    await writeFile(partial, body);
    await rename(partial, file);
  } catch {}
}

const network = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const host = new URL(url).host;
  if (!OG_HOSTS.has(host)) return network(input, init);
  const dir = testCache ?? (host === EMOJI_HOST ? emojiCache : null);
  const file = dir
    ? join(dir, createHash("sha256").update(url).digest("hex"))
    : null;
  const cached = file ? await fromCache(file) : null;
  if (cached) return cached;
  let failure = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const response = await network(input, init);
      if (response.ok) {
        const body = new Uint8Array(await response.arrayBuffer());
        if (dir && file) await intoCache(dir, file, body);
        return new Response(body);
      }
      if (response.status < 500) return response;
      failure = new Error(`${url}: HTTP ${response.status}`);
    } catch (error) {
      failure = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150 * 2 ** attempt));
  }
  throw failure;
};

parentPort.on("message", async (task) => {
  try {
    const fonts = fontOptions(task.fonts);
    const response = new ImageResponse(task.element, {
      width: task.width,
      height: task.height,
      ...(fonts ? { fonts } : {}),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    parentPort.postMessage({ id: task.id, bytes }, [bytes.buffer]);
  } catch (error) {
    parentPort.postMessage({
      id: task.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
