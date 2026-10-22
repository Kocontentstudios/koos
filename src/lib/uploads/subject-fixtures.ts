import sharp from "sharp";

/**
 * Images for the subject check (subject-check.ts), built in memory (no
 * binaries in the repo). The first two stand in for the FEAT-033 U3 live
 * critic's photo-a (a near-white photo, mean 254.7, sd 0.5) and photo-b (a
 * white wall texture); the rest are the legitimate minimal images the check
 * must never refuse. Each is a stored upload as the normaliser writes it:
 * JPEG at quality 90, or PNG when it has transparency.
 */

export interface SubjectFixture {
  name: string;
  type: "png" | "jpeg";
  bytes: Buffer;
  /** What the check must decide. */
  blank: boolean;
}

/* Deterministic, so a failure reproduces byte for byte. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const jpeg = (svg: string) =>
  sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();

const svgOf = (width: number, height: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`;

/** Near-white with sensor-level noise: photo-a, a photo of a blank sheet. */
export async function nearWhitePhoto(): Promise<Buffer> {
  const width = 2560;
  const height = 1707;
  const next = random(5);
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 1) {
    pixels[i] = next() < 0.3 ? 254 : 255;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

/**
 * A pale wall: blotches of a few levels at several scales, fine plaster
 * grain, and a handful of small dark specks, as photo-b. Coverage 0% and
 * edge energy 1.0, against photo-b's 0% and 2.5.
 */
export async function whiteWallTexture(): Promise<Buffer> {
  const width = 2560;
  const height = 1707;
  const next = random(17);
  const blotches = await sharp(
    Buffer.from(Array.from({ length: 40 * 27 }, () => Math.round(next() * 24))),
    { raw: { width: 40, height: 27, channels: 1 } },
  )
    .resize(width, height, { kernel: "cubic" })
    .raw()
    .toBuffer();
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    const level = 238 - blotches[i] / 2 + (next() - 0.5) * 14;
    pixels[i * 3] = clamp(level - 10);
    pixels[i * 3 + 1] = clamp(level - 4);
    pixels[i * 3 + 2] = clamp(level + 8);
  }
  for (let speck = 0; speck < 6; speck += 1) {
    const cx = Math.floor(next() * width);
    const cy = Math.floor(next() * height);
    for (let y = cy - 4; y <= cy + 4; y += 1) {
      for (let x = cx - 4; x <= cx + 4; x += 1) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        pixels.fill(120, (y * width + x) * 3, (y * width + x) * 3 + 3);
      }
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

/** A dark bottle `widthShare` of the frame wide, centred on white. */
export function productOnWhite({
  widthShare,
  colour,
  shadow,
}: {
  widthShare: number;
  colour: string;
  shadow: boolean;
}): Promise<Buffer> {
  const side = 2560;
  const w = Math.round(side * widthShare);
  const h = Math.round(w * 2.2);
  const x = (side - w) / 2;
  const y = (side - h) / 2;
  const shadowShape = shadow
    ? `<ellipse cx="${side / 2}" cy="${y + h}" rx="${w * 0.7}" ry="${h * 0.05}" fill="#000" opacity="0.15"/>`
    : "";
  return jpeg(
    svgOf(
      side,
      side,
      `<rect width="100%" height="100%" fill="#fff"/>${shadowShape}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${w / 5}" fill="${colour}"/>`,
    ),
  );
}

/** A plain white product with only a soft shadow to separate it from white. */
export function whiteProductWithShadow(): Promise<Buffer> {
  const side = 2560;
  return jpeg(
    svgOf(
      side,
      side,
      `<defs><filter id="s"><feGaussianBlur stdDeviation="30"/></filter></defs><rect width="100%" height="100%" fill="#fff"/><ellipse cx="1280" cy="1700" rx="420" ry="70" fill="#000" opacity="0.35" filter="url(#s)"/><rect x="980" y="700" width="600" height="1000" rx="90" fill="#f4f4f4" stroke="#d0d0d0" stroke-width="6"/>`,
    ),
  );
}

/** A flat-colour silhouette on transparency, as a cutout logo-like product. */
export function flatCutout(): Promise<Buffer> {
  return sharp(
    Buffer.from(
      svgOf(1600, 1600, '<circle cx="800" cy="800" r="420" fill="#ffffff"/>'),
    ),
  )
    .png()
    .toBuffer();
}

export async function subjectFixtures(): Promise<SubjectFixture[]> {
  const flat = (background: string) =>
    jpeg(
      svgOf(
        2000,
        1500,
        `<rect width="100%" height="100%" fill="${background}"/>`,
      ),
    );
  return [
    {
      name: "near-white photo (photo-a)",
      type: "jpeg",
      bytes: await nearWhitePhoto(),
      blank: true,
    },
    {
      name: "white wall texture (photo-b)",
      type: "jpeg",
      bytes: await whiteWallTexture(),
      blank: true,
    },
    {
      name: "solid brand red",
      type: "jpeg",
      bytes: await flat("#c0392b"),
      blank: true,
    },
    {
      name: "solid black",
      type: "jpeg",
      bytes: await flat("#000000"),
      blank: true,
    },
    {
      name: "dark bottle 5% wide on white",
      type: "jpeg",
      bytes: await productOnWhite({
        widthShare: 0.05,
        colour: "#2a2a2a",
        shadow: false,
      }),
      blank: false,
    },
    {
      name: "dark bottle 10% wide on white, shadowed",
      type: "jpeg",
      bytes: await productOnWhite({
        widthShare: 0.1,
        colour: "#2a2a2a",
        shadow: true,
      }),
      blank: false,
    },
    {
      name: "pale grey product 10% wide on white",
      type: "jpeg",
      bytes: await productOnWhite({
        widthShare: 0.1,
        colour: "#d6d6d6",
        shadow: false,
      }),
      blank: false,
    },
    {
      name: "white product, outline and soft shadow",
      type: "jpeg",
      bytes: await whiteProductWithShadow(),
      blank: false,
    },
    {
      name: "white disc cut out on transparency",
      type: "png",
      bytes: await flatCutout(),
      blank: false,
    },
    {
      name: "two flat colours",
      type: "jpeg",
      bytes: await jpeg(
        svgOf(
          2000,
          1500,
          '<rect width="100%" height="100%" fill="#0f172a"/><rect width="50%" height="100%" fill="#f97316"/>',
        ),
      ),
      blank: false,
    },
  ];
}

/**
 * An area-averaging (box) downscale to the subject thumbnail, weighting
 * colour by alpha, as a browser canvas does when it draws a large image
 * small. The server uses libvips' own resampler, so testing both shows the
 * thresholds do not depend on which one drew the thumbnail.
 */
export function boxThumbnail(
  rgba: Uint8Array,
  width: number,
  height: number,
  size: { width: number; height: number },
): Uint8Array {
  const out = new Uint8Array(size.width * size.height * 4);
  for (let ty = 0; ty < size.height; ty += 1) {
    for (let tx = 0; tx < size.width; tx += 1) {
      const x0 = Math.floor((tx * width) / size.width);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / size.width));
      const y0 = Math.floor((ty * height) / size.height);
      const y1 = Math.max(
        y0 + 1,
        Math.floor(((ty + 1) * height) / size.height),
      );
      const sum = [0, 0, 0, 0];
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * width + x) * 4;
          const alpha = rgba[i + 3];
          for (let c = 0; c < 3; c += 1) sum[c] += rgba[i + c] * alpha;
          sum[3] += alpha;
          count += 1;
        }
      }
      const o = (ty * size.width + tx) * 4;
      for (let c = 0; c < 3; c += 1) {
        out[o + c] = sum[3] ? Math.round(sum[c] / sum[3]) : 0;
      }
      out[o + 3] = Math.round(sum[3] / count);
    }
  }
  return out;
}
