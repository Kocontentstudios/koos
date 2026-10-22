/**
 * Runs the real browser normaliser (src/lib/uploads/normalize-image.ts) in
 * headless Chromium on a folder of photos and reports, for each, what the
 * upload would do and the subject check's numbers on the thumbnail the
 * browser drew. The unit tests fake the canvas; this is the canvas.
 *
 * The modules are served unbundled (browser-module-server.mts).
 *
 * Usage: corepack pnpm eval:subject-check [dir] [expectations.json]
 * dir defaults to /tmp/feat-033/fixtures (the FEAT-033 critic's photos).
 * expectations.json maps a file name to "accepted" or a refusal reason;
 * without it every file whose name starts "photo-" is expected to be
 * refused as no_subject and every other file accepted. Exits 1 on any miss.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright";
import { IMPORT_MAP, startModuleServer } from "./browser-module-server.mjs";

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

const PAGE = `<!doctype html>${IMPORT_MAP}
<script type="module">
import { normalizeImageForUpload } from "/src/lib/uploads/normalize-image";
import { measureSubject } from "/src/lib/uploads/subject-check";
window.evaluate = async (name, type) => {
  const blob = await (await fetch("/fixture/" + encodeURIComponent(name))).blob();
  const file = new File([blob], name, { type });
  const started = performance.now();
  let outcome;
  let measure = {};
  try {
    const out = await normalizeImageForUpload(file, {
      onSubjectThumbnail: (t) => { measure = measureSubject(t); },
    });
    outcome = { result: "accepted", type: out.type, width: out.width, height: out.height, bytes: out.blob.size };
  } catch (err) {
    outcome = { result: err.reason ?? String(err) };
  }
  const ms = Math.round(performance.now() - started);
  return { ...outcome, ms, ...measure };
};
window.ready = true;
</script>`;

const { server, url } = await startModuleServer(PAGE, (name) =>
  readFileSync(join(dir, name)),
);

const browser = await chromium.launch();
let misses = 0;
try {
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(url);
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
