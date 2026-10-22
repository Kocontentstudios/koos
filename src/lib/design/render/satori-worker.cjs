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

/* Test runs only (testing-og-assets.ts sets the variable): next/og fetches
   fallback faces and emoji while it renders, and a suite that saturates
   every core makes those fetches flaky. The same bytes are kept on disk. */
const OG_HOSTS = new Set([
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
]);
const cacheDir = process.env.KOOS_OG_ASSET_CACHE;
if (cacheDir) {
  const network = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (!OG_HOSTS.has(new URL(url).host)) return network(input, init);
    const file = join(cacheDir, createHash("sha256").update(url).digest("hex"));
    try {
      return new Response(await readFile(file));
    } catch {}
    let failure = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await network(input, init);
        if (response.ok) {
          const body = new Uint8Array(await response.arrayBuffer());
          await mkdir(cacheDir, { recursive: true });
          const partial = `${file}.${process.pid}.${Math.random()}.part`;
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
