/**
 * Runs the real browser normaliser (src/lib/uploads/normalize-image.ts) in
 * headless Chromium on a folder of photos and reports, for each, what the
 * upload would do and the subject check's numbers on the thumbnail the
 * browser drew. The unit tests fake the canvas; this is the canvas.
 *
 * The modules are served as they are, with types stripped by the TypeScript
 * compiler and "@/" mapped by an import map, so nothing is bundled.
 *
 * Usage: corepack pnpm eval:subject-check [dir] [expectations.json]
 * dir defaults to /tmp/feat-033/fixtures (the FEAT-033 critic's photos).
 * expectations.json maps a file name to "accepted" or a refusal reason;
 * without it every file whose name starts "photo-" is expected to be
 * refused as no_subject and every other file accepted. Exits 1 on any miss.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const dir = resolve(process.argv[2] ?? "/tmp/feat-033/fixtures");
const expectations: Record<string, string> | null = process.argv[3]
  ? JSON.parse(readFileSync(process.argv[3], "utf8"))
  : null;

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const PAGE = `<!doctype html><script type="importmap">{"imports":{"@/":"/src/"}}</script>
<script type="module">
import { normalizeImageForUpload } from "/src/lib/uploads/normalize-image";
import { measureSubject, subjectThumbnailSize } from "/src/lib/uploads/subject-check";
import { fitWithinLongEdge } from "/src/lib/uploads/normalize-image";
window.evaluate = async (name, type) => {
  const blob = await (await fetch("/fixture/" + encodeURIComponent(name))).blob();
  const file = new File([blob], name, { type });
  const started = performance.now();
  let outcome;
  try {
    const out = await normalizeImageForUpload(file);
    outcome = { result: "accepted", type: out.type, width: out.width, height: out.height, bytes: out.blob.size };
  } catch (err) {
    outcome = { result: err.reason ?? String(err) };
  }
  const ms = Math.round(performance.now() - started);
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const size = fitWithinLongEdge(bitmap.width, bitmap.height, 2560);
  const canvas = document.createElement("canvas");
  Object.assign(canvas, size);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  const t = subjectThumbnailSize(size.width, size.height);
  const thumb = document.createElement("canvas");
  Object.assign(thumb, t);
  const tctx = thumb.getContext("2d");
  tctx.imageSmoothingQuality = "high";
  tctx.drawImage(canvas, 0, 0, t.width, t.height);
  const measure = measureSubject(tctx.getImageData(0, 0, t.width, t.height).data, t.width, t.height);
  return { ...outcome, ms, ...measure };
};
window.ready = true;
</script>`;

function serveSource(path: string): string | null {
  const base = join(ROOT, path);
  for (const candidate of [base, `${base}.ts`]) {
    try {
      const text = readFileSync(candidate, "utf8");
      return ts.transpileModule(text, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText;
    } catch {}
  }
  return null;
}

const server = createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  if (url === "/") {
    res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
  } else if (url.startsWith("/fixture/")) {
    const name = url.slice("/fixture/".length);
    res.writeHead(200).end(readFileSync(join(dir, name)));
  } else if (url.startsWith("/src/")) {
    const js = serveSource(url.slice(1));
    if (js === null) res.writeHead(404).end();
    else res.writeHead(200, { "content-type": "text/javascript" }).end(js);
  } else {
    res.writeHead(404).end();
  }
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;

const browser = await chromium.launch();
let misses = 0;
try {
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => (window as { ready?: boolean }).ready);
  const files = readdirSync(dir).filter((f) => MIME[extname(f).toLowerCase()]);
  for (const name of files.sort()) {
    const got = await page.evaluate(
      ([n, t]) =>
        (
          window as unknown as {
            evaluate: (
              n: string,
              t: string,
            ) => Promise<Record<string, unknown>>;
          }
        ).evaluate(n, t),
      [name, MIME[extname(name).toLowerCase()]],
    );
    const want =
      expectations?.[name] ??
      (name.startsWith("photo-") ? "no_subject" : "accepted");
    const pass = got.result === want;
    if (!pass) misses += 1;
    console.log(
      JSON.stringify({
        file: name,
        want,
        ...got,
        coverage: Number((Number(got.coverage) * 100).toFixed(2)),
        edgeEnergy: Number(Number(got.edgeEnergy).toFixed(2)),
        pass,
      }),
    );
  }
} finally {
  await browser.close();
  server.close();
}
console.log(misses === 0 ? "PASS" : `FAIL: ${misses} unexpected`);
process.exit(misses === 0 ? 0 : 1);
