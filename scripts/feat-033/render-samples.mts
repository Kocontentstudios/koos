/**
 * Renders every layout as a layer document and as today's flex composite,
 * side by side, for review (KOOS-V1-FEAT-033 PR 1).
 *
 *   corepack pnpm tsx scripts/feat-033/render-samples.mts <outDir> [fixturesDir] [--only=<substring>]
 *
 * For each layout and aspect ratio, and for each image, writes
 * <name>.doc.png (rasterizeDocument) and <name>.flex.png
 * (renderCompositeDesign, the same spec and image as its plate). A
 * manifest.json records timings, probe counts, copy and subject faults, the
 * subject measurement (subject.ts) and the measured contrast of every run of
 * copy against the picture behind it (contrast-probe.ts).
 *
 * Every photo goes through what the browser does before upload
 * (src/lib/uploads/normalize-image.ts): drawn in Chromium at no more than
 * 2560px on the long edge and re-encoded as JPEG at quality 0.9, or PNG when
 * it has transparency. The server refuses anything over 4096px, so this is
 * the only way a camera-sized photo reaches the renderer.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { chromium } from "playwright";
import { createElement as h } from "react";
import type { AspectRatio } from "@/lib/ai/image/types";
import { canvasFor } from "@/lib/design/canvas";
import {
  copyContrast,
  withoutCopy,
} from "@/lib/design/document/contrast-probe";
import { documentFromSpec } from "@/lib/design/document/from-spec";
import { measureImage } from "@/lib/design/document/image-facts";
import { createRendererMeasurer } from "@/lib/design/document/measure";
import {
  prepareDocumentFonts,
  rasterizeDocument,
} from "@/lib/design/document/rasterize";
import { designDocumentSchema } from "@/lib/design/document/schema";
import {
  measureSubject,
  type SubjectBox,
  subjectFromAlpha,
} from "@/lib/design/document/subject";
import { resolveLogoPlacement } from "@/lib/design/logo-placement";
import { resolvePalette } from "@/lib/design/palette";
import { renderCompositeDesign } from "@/lib/design/render/composite";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import { probeLogo } from "@/lib/design/render/logo-probe";
import { DESIGN_LAYOUTS, type DesignSpec } from "@/lib/design/spec";
import {
  cropRgba,
  decodePngRgba,
  encodePngRgba,
  inkBoxOf,
} from "@/lib/images/png-pixels";

const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const only =
  process.argv.find((arg) => arg.startsWith("--only="))?.slice(7) ?? "";
const outDir = args[0];
const fixturesDir = args[1] ?? "/tmp/feat-033/fixtures";
if (!outDir) {
  console.error("usage: render-samples.mts <outDir> [fixturesDir]");
  process.exit(1);
}

interface Asset {
  bytes: Uint8Array;
  contentType: string;
}

const LONG_EDGE = 2560;
const JPEG_QUALITY = 0.9;

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM }
    : {},
);
const page = await browser.newPage();

/** The browser's upload normaliser, run in Chromium on the fixture bytes. */
async function normalise(
  bytes: Uint8Array,
  contentType: string,
): Promise<Asset> {
  const result = await page.evaluate(
    async ({ base64, type, longEdge, quality }) => {
      const blob = await (await fetch(`data:${type};base64,${base64}`)).blob();
      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(
        1,
        longEdge / Math.max(bitmap.width, bitmap.height),
      );
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, width, height);
      const { data } = ctx.getImageData(0, 0, width, height);
      let transparent = false;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 255) {
          transparent = true;
          break;
        }
      }
      if (!transparent) {
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, width, height);
      }
      const out = transparent ? "image/png" : "image/jpeg";
      const encoded = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, out, quality),
      );
      if (!encoded) throw new Error("encode failed");
      const buffer = new Uint8Array(await encoded.arrayBuffer());
      let binary = "";
      for (let i = 0; i < buffer.length; i += 0x8000) {
        binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
      }
      return { base64: btoa(binary), type: out };
    },
    {
      base64: Buffer.from(bytes).toString("base64"),
      type: contentType,
      longEdge: LONG_EDGE,
      quality: JPEG_QUALITY,
    },
  );
  return {
    bytes: new Uint8Array(Buffer.from(result.base64, "base64")),
    contentType: result.type,
  };
}

/** A dark, busy photograph: the cut-out over a deep brown gradient, flattened
 *  to an opaque plate. Both fixture photos are near-white, so this is what
 *  shows the veil choosing light type. */
async function darkPhoto(cutout: Asset): Promise<Asset> {
  const width = 1500;
  const height = 1000;
  const src = `data:${cutout.contentType};base64,${Buffer.from(cutout.bytes).toString("base64")}`;
  const response = new ImageResponse(
    h(
      "div",
      {
        style: {
          display: "flex",
          width,
          height,
          backgroundImage:
            "linear-gradient(135deg, #2A1A10 0%, #5A3A22 55%, #1A120C 100%)",
        },
      },
      h("img", { src, width: 1000, height: 1000, style: { marginLeft: 250 } }),
    ),
    { width, height },
  );
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: "image/png",
  };
}

/** A test wordmark, drawn once and cropped to its ink like an uploaded file. */
async function wordmark(): Promise<Asset> {
  const fonts = await loadBrandFonts(null);
  const response = new ImageResponse(
    h(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          width: 1200,
          height: 300,
          gap: 28,
          paddingLeft: 20,
        },
      },
      h(
        "div",
        {
          style: {
            width: 150,
            height: 150,
            borderRadius: 75,
            backgroundColor: "#3B2416",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#FFF4E6",
            fontFamily: "Display",
            fontWeight: 700,
            fontSize: 96,
          },
        },
        "C",
      ),
      h(
        "div",
        {
          style: {
            display: "flex",
            fontFamily: "Display",
            fontWeight: 700,
            fontSize: 120,
            color: "#3B2416",
          },
        },
        "Crumb & Co.",
      ),
    ),
    {
      width: 1200,
      height: 300,
      fonts: fonts.map((f) => ({
        name: f.name,
        data: f.data,
        weight: f.weight,
        style: f.style,
      })),
    },
  );
  const decoded = decodePngRgba(new Uint8Array(await response.arrayBuffer()));
  const box = decoded && inkBoxOf(decoded);
  if (!decoded || !box) throw new Error("wordmark did not draw");
  return {
    bytes: encodePngRgba(cropRgba(decoded, box)),
    contentType: "image/png",
  };
}

const SUBJECTS: Record<"cafe" | "portrait", SubjectBox> = {
  cafe: { x: 0.29, y: 0.4, w: 0.53, h: 0.54 },
  portrait: { x: 0.34, y: 0.27, w: 0.42, h: 0.34 },
};

const BRAND = {
  primaryColor: "#FFF4E6",
  secondaryColor: "#C2410C",
};

const COPY = {
  headline: "Fresh croissants, baked before sunrise",
  subheadline:
    "Flaky, buttery and still warm. Come in early for the first batch of the day.",
  cta: "Order for pickup",
  footerLines: ["12 Admiralty Way, Lekki · Open daily 7am to 6pm"],
};

/* The schema's maxima: 70, 140 and 32 characters, three 60-character footer
   lines, with one long unbroken word in the headline. */
const WORST = {
  headline:
    "Our Christmas pre-order window closes Friday: reserve croissants now!!",
  subheadline:
    "Butter croissants, almond twice-baked, pain au chocolat and our seasonal panettone, all baked fresh at dawn, and boxed ready for collection.",
  cta: "Reserve your Christmas box today",
  footerLines: [
    "12 Admiralty Way, Lekki Phase 1, Lagos · Mon-Sun 7am to 6pm.",
    "Call or WhatsApp 0803 555 0142 · hello@crumbandco.ng anytime",
    "Pre-orders close 20 December · Collect 23 or 24 Dec, 8am-1pm",
  ],
};

function specFor(
  layout: DesignSpec["layout"],
  aspectRatio: AspectRatio,
  copy: typeof COPY,
): DesignSpec {
  const footer = {
    footerStyle: "text" as const,
    footerLines: copy.footerLines,
  };
  return {
    layout,
    headline: copy.headline,
    subheadline: copy.subheadline,
    cta: copy.cta,
    ...footer,
    palette: {
      background: "#FFF4E6",
      foreground: "#3B2416",
      accent: "#C2410C",
    },
    logoPlacement: resolveLogoPlacement({
      modelChoice: "top-right",
      hasLogo: true,
      layout,
      logoFree: false,
      footer,
    }),
    logoFree: false,
    logoFreeQuote: "",
    backgroundPrompt: "unused",
    backgroundTreatment: "photographic",
    nativePrompt: "unused",
    aspectRatio,
  };
}

const RATIOS: Record<DesignSpec["layout"], AspectRatio[]> = {
  "hero-center": ["4:5", "1:1", "9:16", "16:9"],
  "split-left": ["4:5", "1:1"],
  "banner-bottom": ["4:5", "1:1", "9:16", "16:9"],
  "quote-card": ["4:5", "1:1"],
  "stat-highlight": ["4:5", "1:1"],
};

await mkdir(outDir, { recursive: true });

const fixture = async (file: string, contentType = "image/jpeg") =>
  normalise(
    new Uint8Array(await readFile(join(fixturesDir, file))),
    contentType,
  );

const cutoutAsset = await fixture("cutout.png", "image/png");

interface Sample {
  key: string;
  asset: Asset;
  /** Where the subject is, as shares of the image, supplied by hand the way
   *  the generation job will pass the one it detects. */
  subject?: SubjectBox;
}

/* Subject boxes measured by eye on the normalised fixtures: the espresso
   machine on the cafe counter, the model's face and upper body. */
const images: Record<string, Sample | null> = {
  photo: {
    key: "design-images/samples/photo-a.jpg",
    asset: await fixture("photo-a.jpg"),
  },
  cutout: { key: "design-images/samples/cutout.png", asset: cutoutAsset },
  none: null,
  darkphoto: {
    key: "design-images/samples/dark.png",
    asset: await darkPhoto(cutoutAsset),
  },
  wall: {
    key: "design-images/samples/photo-b.jpg",
    asset: await fixture("photo-b.jpg"),
  },
  cafe: {
    key: "design-images/samples/cafe.jpg",
    asset: await fixture("busy-cafe-espresso.jpg"),
    subject: SUBJECTS.cafe,
  },
  sky: {
    key: "design-images/samples/sky.jpg",
    asset: await fixture("sky-over-stone.jpg"),
  },
  portrait: {
    key: "design-images/samples/portrait.jpg",
    asset: await fixture("portrait-fashion.jpg"),
    subject: SUBJECTS.portrait,
  },
  storefront: {
    key: "design-images/samples/storefront.jpg",
    asset: await fixture("busy-storefront-24mp.jpg"),
  },
};
await browser.close();
await mkdir(join(outDir, "_inputs"), { recursive: true });
for (const [name, image] of Object.entries(images)) {
  if (!image) continue;
  const extension = image.asset.contentType === "image/png" ? "png" : "jpg";
  await writeFile(
    join(outDir, "_inputs", `${name}.${extension}`),
    image.asset.bytes,
  );
}
const facts = Object.fromEntries(
  await Promise.all(
    Object.entries(images).map(async ([name, image]) => [
      name,
      image ? await measureImage(image.asset) : null,
    ]),
  ),
);

/* The dark photo is the cut-out drawn 1000px square at x 250 of a 1500px
   wide frame, so its subject is the cut-out's alpha bounds moved there. */
const cutoutFacts = facts.cutout;
if (images.darkphoto && cutoutFacts) {
  const alpha = subjectFromAlpha(cutoutFacts);
  images.darkphoto.subject = {
    x: (250 + alpha.x * 1000) / 1500,
    y: alpha.y,
    w: (alpha.w * 1000) / 1500,
    h: alpha.h,
  };
}

const logoAsset = await wordmark();
const logoProbe = await probeLogo(logoAsset);
const LOGO_KEY = "logos/samples/wordmark.png";
await writeFile(join(outDir, "_wordmark.png"), logoAsset.bytes);

const manifest: unknown[] = [];
for (const layout of DESIGN_LAYOUTS) {
  for (const ratio of RATIOS[layout]) {
    const variants: [string, typeof COPY][] = [["", COPY]];
    if (ratio === "4:5") variants.push(["_worst", WORST]);
    for (const [suffix, copy] of variants) {
      for (const [imageName, image] of Object.entries(images)) {
        /* Worst-case copy runs on the round-1 images only; the photos added
           since test the picture, not the copy. */
        if (suffix && !["photo", "cutout", "none"].includes(imageName))
          continue;
        const spec = specFor(layout, ratio, copy);
        const name = `${layout}_${ratio.replace(":", "x")}_${imageName}${suffix}`;
        if (!name.includes(only)) continue;
        const palette = resolvePalette(spec.palette, BRAND);

        const started = performance.now();
        const sample = [
          spec.headline,
          spec.subheadline,
          spec.cta,
          ...spec.footerLines,
        ].join(" ");
        const { fonts } = await prepareDocumentFonts({}, sample);
        const measurer = createRendererMeasurer({ fonts });
        const build = await documentFromSpec({
          spec,
          palette,
          canvas: canvasFor(ratio),
          image: image ? { key: image.key } : null,
          imageFacts: facts[imageName],
          subject: image?.subject ?? null,
          logo: { asset: { key: LOGO_KEY }, aspect: logoProbe.aspect },
          measurer,
        });
        const imageFacts = facts[imageName];
        const subjectBox =
          image?.subject ??
          (imageFacts?.cutout ? subjectFromAlpha(imageFacts) : null);
        const subjectReport =
          imageFacts && subjectBox
            ? measureSubject(build.document, imageFacts, subjectBox)
            : null;
        const doc = designDocumentSchema.parse(build.document);
        const built = performance.now();
        const assets = {
          [LOGO_KEY]: logoAsset,
          ...(image ? { [image.key]: image.asset } : {}),
        };
        const rendered = await rasterizeDocument({
          doc,
          assets,
          brand: {},
          logoInk: {
            [LOGO_KEY]: {
              darkest: logoProbe.darkest,
              lightest: logoProbe.lightest,
            },
          },
          fonts,
        });
        const done = performance.now();
        const ground = decodePngRgba(
          (
            await rasterizeDocument({
              doc: withoutCopy(rendered.document),
              assets,
              brand: {},
              fonts,
            })
          ).bytes,
        );
        const contrast = ground
          ? copyContrast(ground, rendered.document).map((c) => ({
              id: c.id,
              under45: Math.round(c.under45 * 1000) / 10,
              under3: Math.round(c.under3 * 1000) / 10,
            }))
          : null;
        await writeFile(join(outDir, `${name}.doc.png`), rendered.bytes);
        await writeFile(
          join(outDir, `${name}.doc.json`),
          JSON.stringify(rendered.document, null, 2),
        );

        const flex = await renderCompositeDesign({
          spec,
          brand: BRAND,
          plate: image ? image.asset : null,
          logo: {
            ...logoAsset,
            darkest: logoProbe.darkest,
            lightest: logoProbe.lightest,
            aspect: logoProbe.aspect,
          },
        });
        await writeFile(join(outDir, `${name}.flex.png`), flex.bytes);

        const entry = {
          name,
          buildMs: Math.round(built - started),
          rasterMs: Math.round(done - built),
          probes: measurer.probes(),
          copyFault: build.copyFault,
          subjectFault: build.subjectFault,
          subject: subjectReport && {
            ok: subjectReport.ok,
            edgeShare: Math.round(subjectReport.edgeShare * 100) / 100,
            visibleShare: Math.round(subjectReport.visibleShare * 1000) / 1000,
            overlaps: subjectReport.overlaps.map((o) => o.id),
          },
          logoFault: rendered.logoFault,
          flexLogoFault: flex.logoFault,
          contrastPct: contrast,
        };
        manifest.push(entry);
        console.log(JSON.stringify(entry));
      }
    }
  }
}
await writeFile(
  join(outDir, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(`wrote ${manifest.length * 2} renders to ${outDir}`);
