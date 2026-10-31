/**
 * Composes each image into a full 1080 x 1350 design through
 * renderCompositeDesign, the production path, in a process of its own, for
 * the same reason as render-gate-child.mjs: an abort cannot be caught.
 * Spawned by renderInChild (render-in-child.ts) with `via: "composite"`,
 * under tsx so the TypeScript renderer and its "@/" imports load as they are.
 *
 * Usage: node --import tsx composite-gate-child.mts <dir>, same manifest and
 * output as render-gate-child.mjs.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderCompositeDesign } from "@/lib/design/render/composite";
import type { DesignSpec } from "@/lib/design/spec";

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

interface Entry {
  file: string;
  name: string;
  contentType: string;
}

type Plate = { bytes: Uint8Array; contentType: string };

async function compose(plate: Plate | null): Promise<Buffer> {
  const { bytes } = await renderCompositeDesign({
    spec: SPEC,
    brand: {},
    plate,
    logo: null,
  });
  return Buffer.from(bytes);
}

const dir = process.argv[2];
const manifest: Entry[] = JSON.parse(
  readFileSync(join(dir, "manifest.json"), "utf8"),
);
const noImage = await compose(null);
const verdicts: Record<string, string> = {};
const digests: Record<string, string> = {};
for (const { file, name, contentType } of manifest) {
  process.stderr.write(`START ${name}\n`);
  try {
    const out = await compose({
      bytes: readFileSync(join(dir, file)),
      contentType,
    });
    verdicts[name] = out.equals(noImage) ? "empty" : "drawn";
    digests[name] = createHash("sha256").update(out).digest("hex");
  } catch (err) {
    verdicts[name] = `threw ${String(err).slice(0, 120)}`;
  }
}
process.stdout.write(`${JSON.stringify({ verdicts, digests })}\n`);
