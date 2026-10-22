/**
 * Runs SVG logos through one brand-logo path in a process of its own, for
 * the same reason as render-gate-child.mjs: librsvg's PNG decoder aborts on
 * some embedded images and an abort cannot be caught. Spawned by
 * runSvgAttacksInChild (svg-attack-in-child.ts).
 *
 * Usage: node --import tsx svg-attack-child.mts <mode> <dir>, where mode is
 *  - upload: the real POST /api/upload handler, sent the file as an SVG;
 *  - logo-colors: the real POST /api/brand/logo-colors handler, the file
 *    stored as the brand's logo;
 *  - logo: loadBrandLogo on the stored file, then, when it loads, a full
 *    design through renderCompositeDesign with it as the logo.
 * Session, database, rate limiter and vision model are stubbed (route-stubs/);
 * storage is the real module over a stubbed S3 client. <dir>/manifest.json
 * lists { file, name }. Prints each name to stderr before running it, then
 * one `RESULT {json}` line per file to stdout as it finishes, so the results
 * before an abort survive it.
 */
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { DesignSpec } from "@/lib/design/spec";
import { peakRssMB } from "@/lib/images/peak-rss";

registerHooks(await import("./route-stubs/hooks.mjs"));

process.env.R2_ACCOUNT_ID = "test";
process.env.R2_ACCESS_KEY_ID = "test";
process.env.R2_SECRET_ACCESS_KEY = "test";
process.env.R2_BUCKET = "test";
process.env.R2_PUBLIC_BASE_URL = "https://cdn.example.test";

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const LOGO_URL = "https://cdn.example.test/logos/u1/1-abc.svg";

let stored: Uint8Array = new Uint8Array();
const { S3Client } = await import("@aws-sdk/client-s3");
S3Client.prototype.send = (async (command: {
  constructor: { name: string };
  input: { Range?: string };
}) => {
  if (command.constructor.name !== "GetObjectCommand") return {};
  const end = command.input.Range?.match(/-(\d+)$/)?.[1];
  const body = end ? stored.subarray(0, Number(end) + 1) : stored;
  return { Body: { transformToByteArray: async () => new Uint8Array(body) } };
}) as unknown as typeof S3Client.prototype.send;

/* Silenced: the logo loader logs every refusal, which is the point of it,
   and would bury the RESULT lines. */
console.error = () => {};

type Mode = "upload" | "logo-colors" | "logo";
const [mode, dir] = process.argv.slice(2) as [Mode, string];

const run: Record<Mode, (bytes: Uint8Array) => Promise<object>> = {
  async upload(bytes) {
    const { POST } = await import("@/app/api/upload/route");
    const form = new FormData();
    form.set(
      "file",
      new File([new Uint8Array(bytes)], "logo.svg", { type: "image/svg+xml" }),
    );
    const res = await POST(
      new Request("http://x.test/api/upload", { method: "POST", body: form }),
    );
    const body = await res.json();
    return { status: res.status, error: body.error ?? null };
  },

  async "logo-colors"(bytes) {
    const { POST } = await import("@/app/api/brand/logo-colors/route");
    stored = bytes;
    const g = globalThis as { __visionImage?: { bytes: Uint8Array } };
    g.__visionImage = undefined;
    const sentToVision = () => g.__visionImage;
    const res = await POST(
      new Request("http://x.test/api/brand/logo-colors", {
        method: "POST",
        body: JSON.stringify({ brandId: BRAND, logoUrl: LOGO_URL }),
      }),
    );
    return {
      status: res.status,
      sentToVisionBytes: sentToVision()?.bytes.length ?? null,
    };
  },

  async logo(bytes) {
    const { loadBrandLogo } = await import("@/lib/design/render/logo");
    const { renderCompositeDesign } = await import(
      "@/lib/design/render/composite"
    );
    stored = bytes;
    const { logo, fault } = await loadBrandLogo(LOGO_URL);
    if (!logo) return { fault };
    const compose = async (withLogo: boolean) =>
      Buffer.from(
        (
          await renderCompositeDesign({
            spec: SPEC,
            brand: {},
            plate: null,
            logo: withLogo ? logo : null,
          })
        ).bytes,
      );
    const without = await compose(false);
    const started = performance.now();
    const drawn = await compose(true);
    return {
      fault: null,
      logoBytes: logo.bytes.length,
      composite: drawn.equals(without) ? "empty" : "drawn",
      compositeMs: Math.round(performance.now() - started),
    };
  },
};

const SPEC: DesignSpec = {
  layout: "hero-center",
  headline: "Lagos Launch Week",
  subheadline: "Free delivery for the first three days",
  cta: "Order now",
  palette: { background: "#0F172A", foreground: "#FFFFFF", accent: "#F97316" },
  logoPlacement: "bottom-right",
  logoFree: false,
  logoFreeQuote: "",
  footerStyle: "none",
  footerLines: [],
  backgroundPrompt: "x",
  backgroundTreatment: "photographic",
  nativePrompt: "x",
  aspectRatio: "4:5",
};

const manifest: { file: string; name: string }[] = JSON.parse(
  readFileSync(join(dir, "manifest.json"), "utf8"),
);
for (const { file, name } of manifest) {
  process.stderr.write(`START ${name}\n`);
  const bytes = new Uint8Array(readFileSync(join(dir, file)));
  const started = performance.now();
  let result: object;
  try {
    result = await run[mode](bytes);
  } catch (err) {
    result = {
      threw: `${(err as Error)?.name}: ${String((err as Error)?.message).slice(0, 160)}`,
    };
  }
  process.stdout.write(
    `RESULT ${JSON.stringify({
      name,
      mode,
      ...result,
      ms: Math.round(performance.now() - started),
      rssMB: Math.round(process.memoryUsage().rss / 2 ** 20),
      peakRssMB: peakRssMB(),
    })}\n`,
  );
}
