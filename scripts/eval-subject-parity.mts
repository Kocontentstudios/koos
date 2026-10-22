/**
 * The subject check's browser/server parity on the real canvas (round-5
 * review): runs each fine pattern (subject-parity-fixtures.ts) through the
 * real normaliser in headless Chromium, takes the file it would upload, and
 * runs that file through the server's own re-encode and decision. The server
 * is authoritative, so any pattern the browser refuses and the server
 * accepts is a failure. Also reports how far the browser's numbers sit from
 * the server's, which is what BROWSER_MARGIN has to cover.
 *
 * Usage: corepack pnpm eval:subject-parity [out.jsonl]. Exits 1 on any
 * browser refusal the server would accept.
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import sharp from "sharp";
import { reencodeImage } from "../src/lib/images/reencode";
import { DESIGN_IMAGE_REENCODE } from "../src/lib/uploads/design-image";
import {
  BROWSER_MARGIN,
  looksBlank,
  measureSubject,
} from "../src/lib/uploads/subject-check";
import { parityPatterns } from "../src/lib/uploads/subject-parity-fixtures";
import { IMPORT_MAP, startModuleServer } from "./browser-module-server.mjs";

const PAGE = `<!doctype html>${IMPORT_MAP}
<script type="module">
import { normalizeImageForUpload } from "/src/lib/uploads/normalize-image";
const toBase64 = (blob) => new Promise((done) => {
  const reader = new FileReader();
  reader.onload = () => done(String(reader.result).split(",")[1]);
  reader.readAsDataURL(blob);
});
window.evaluate = async (name) => {
  const blob = await (await fetch("/fixture/" + encodeURIComponent(name))).blob();
  let seen;
  let result;
  try {
    await normalizeImageForUpload(new File([blob], name + ".png", { type: "image/png" }), {
      onSubjectThumbnail: (thumbnail, encodeUpload) => { seen = { thumbnail, encodeUpload }; },
    });
    result = "accepted";
  } catch (err) {
    result = err.reason ?? String(err);
  }
  if (!seen) return { result };
  const upload = await seen.encodeUpload();
  return {
    result,
    uploadType: upload.type,
    upload: await toBase64(upload),
    thumbnail: { width: seen.thumbnail.width, height: seen.thumbnail.height, pixels: Array.from(seen.thumbnail.pixels) },
  };
};
window.ready = true;
</script>`;

const out = process.argv[2] ?? "/tmp/feat-033/subject-parity.jsonl";
const sources = new Map<string, Uint8Array>();
const { server, url } = await startModuleServer(
  PAGE,
  (name) => sources.get(name) ?? null,
);
const browser = await chromium.launch();
const lines: string[] = [];
let failures = 0;
let worstPixel = 0;
let worstEdge = 0;
const tally = { n: 0, browserRefused: 0, serverRefused: 0 };
try {
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.error("page error:", err.message));
  await page.goto(url);
  await page.waitForFunction(() => (window as { ready?: boolean }).ready);
  for await (const pattern of parityPatterns()) {
    sources.set(
      pattern.name,
      await sharp(Buffer.from(pattern.rgba), {
        raw: { width: pattern.width, height: pattern.height, channels: 4 },
      })
        .png({ compressionLevel: 1 })
        .toBuffer(),
    );
    const got = (await page.evaluate(
      (n) =>
        (
          window as unknown as {
            evaluate: (n: string) => Promise<Record<string, unknown>>;
          }
        ).evaluate(n),
      pattern.name,
    )) as {
      result: string;
      uploadType?: string;
      upload?: string;
      thumbnail?: { width: number; height: number; pixels: number[] };
    };
    sources.delete(pattern.name);
    if (!got.upload || !got.thumbnail) {
      failures += 1;
      lines.push(JSON.stringify({ name: pattern.name, error: got.result }));
      continue;
    }
    const type = got.uploadType === "image/png" ? "png" : "jpeg";
    const clean = await reencodeImage(
      Buffer.from(got.upload, "base64"),
      type,
      DESIGN_IMAGE_REENCODE,
    );
    const serverThumb = clean.thumbnail;
    if (!serverThumb) throw new Error("the re-encode returned no thumbnail");
    const browserThumb = {
      ...got.thumbnail,
      pixels: Float32Array.from(got.thumbnail.pixels),
    };
    let gap = 0;
    for (let i = 0; i < browserThumb.pixels.length; i += 1) {
      gap = Math.max(
        gap,
        Math.abs(browserThumb.pixels[i] - serverThumb.pixels[i]),
      );
    }
    const b = measureSubject(browserThumb);
    const s = measureSubject(serverThumb);
    const server = looksBlank(s) ? "no_subject" : "accepted";
    const browserRefused = got.result === "no_subject";
    const bad = browserRefused && server === "accepted";
    if (bad) failures += 1;
    worstPixel = Math.max(worstPixel, gap);
    worstEdge = Math.max(worstEdge, Math.abs(b.edgeEnergy - s.edgeEnergy));
    tally.n += 1;
    if (browserRefused) tally.browserRefused += 1;
    if (server !== "accepted") tally.serverRefused += 1;
    lines.push(
      JSON.stringify({
        name: pattern.name,
        browser: got.result,
        server,
        upload: type,
        pixelGap: Number(gap.toFixed(3)),
        coverage: [b.coverage, s.coverage].map((v) =>
          Number((v * 100).toFixed(2)),
        ),
        edgeEnergy: [b.edgeEnergy, s.edgeEnergy].map((v) =>
          Number(v.toFixed(3)),
        ),
        bad,
      }),
    );
  }
} finally {
  await browser.close();
  server.close();
}
const summary = {
  ...tally,
  browserRefusesServerAccepts: failures,
  worstPixelGap: Number(worstPixel.toFixed(3)),
  worstEdgeGap: Number(worstEdge.toFixed(3)),
  margin: BROWSER_MARGIN,
};
lines.push(JSON.stringify(summary));
writeFileSync(out, `${lines.join("\n")}\n`);
console.log(JSON.stringify(summary));
console.log(failures === 0 ? "PASS" : `FAIL: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
