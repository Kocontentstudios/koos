import { deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getObjectBytes = vi.fn();
const rasterizeSvg = vi.fn();
const probeLogo = vi.fn();

vi.mock("@/lib/storage", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    ...actual,
    getObjectBytes: (key: string) => getObjectBytes(key),
  };
});

vi.mock("@/lib/images/rasterize", async () => {
  const actual = await vi.importActual<typeof import("@/lib/images/rasterize")>(
    "@/lib/images/rasterize",
  );
  return {
    ...actual,
    rasterizeSvg: (bytes: Uint8Array, opts?: unknown) =>
      rasterizeSvg(bytes, opts),
  };
});

/* The probe really rasterises, so unit tests stub it and
   logo-probe.smoke.test.ts exercises it against genuinely broken files. */
vi.mock("@/lib/design/render/logo-probe", () => ({
  probeLogo: (logo: unknown) => probeLogo(logo),
}));

const { loadBestLogo, loadBrandLogo } = await import(
  "@/lib/design/render/logo"
);

const BASE = "https://cdn.example.test";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const { logoPng } = await import("@/lib/design/render/logo-fixtures");
const { decodePngRgba, encodePngRgba } = await import(
  "@/lib/images/png-pixels"
);

const svg = (attrs: string) =>
  new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}/>`,
  );

beforeEach(() => {
  process.env.R2_PUBLIC_BASE_URL = BASE;
  getObjectBytes.mockReset();
  rasterizeSvg.mockReset();
  rasterizeSvg.mockResolvedValue(PNG);
  probeLogo.mockReset();
  probeLogo.mockResolvedValue({
    drawable: true,
    darkest: 0.2,
    lightest: 0.2,
    aspect: 1,
  });
});

afterEach(() => {
  process.env.R2_PUBLIC_BASE_URL = undefined;
});

describe("loadBrandLogo", () => {
  it("reports nothing when the brand has no logo", async () => {
    expect(await loadBrandLogo(null)).toEqual({ logo: null, fault: null });
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("labels a PNG as a PNG", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(PNG));
    const { logo, fault } = await loadBrandLogo(`${BASE}/logos/u1/a.png`);
    expect(fault).toBeNull();
    expect(logo?.contentType).toBe("image/png");
  });

  /* The shipped bug: /api/upload accepts JPEG for logos and the loader
     declared every byte string image/png, so satori was handed a JPEG wearing
     a PNG mime and drew nothing. */
  it("labels a JPEG as a JPEG, whatever the key says", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(JPEG));
    const { logo, fault } = await loadBrandLogo(`${BASE}/logos/u1/a.png`);
    expect(fault).toBeNull();
    expect(logo?.contentType).toBe("image/jpeg");
  });

  it("rasterises an SVG onto a transparent ground at its own ratio", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(svg('viewBox="0 0 300 100"')));
    const { logo, fault } = await loadBrandLogo(`${BASE}/logos/u1/a.svg`);
    expect(fault).toBeNull();
    expect(logo?.contentType).toBe("image/png");
    const [, opts] = rasterizeSvg.mock.calls[0];
    expect(opts).toMatchObject({ background: "transparent", width: 600 });
    // 3:1 wordmark must not be squashed into the vision path's 512 square.
    expect((opts as { height: number }).height).toBe(200);
  });

  it("reports a URL that is not ours rather than returning nothing", async () => {
    const { logo, fault } = await loadBrandLogo(
      "https://attacker.test/logos/u1/a.png",
    );
    expect(logo).toBeNull();
    expect(fault).toMatch(/not in KO OS storage/);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("refuses a key outside the logos prefix", async () => {
    const { logo, fault } = await loadBrandLogo(
      `${BASE}/deliverables/other/a.png`,
    );
    expect(logo).toBeNull();
    expect(fault).toMatch(/not in KO OS storage/);
    expect(getObjectBytes).not.toHaveBeenCalled();
  });

  it("reports an unreadable object", async () => {
    getObjectBytes.mockRejectedValue(new Error("gone"));
    const { logo, fault } = await loadBrandLogo(`${BASE}/logos/u1/a.png`);
    expect(logo).toBeNull();
    expect(fault).toMatch(/could not be read/);
  });

  it("reports bytes that are not an image at all", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from("this is a text file"));
    const { logo, fault } = await loadBrandLogo(`${BASE}/logos/u1/a.png`);
    expect(logo).toBeNull();
    expect(fault).toMatch(/not a PNG, JPEG or SVG/);
  });

  /* A logo exported on a roomy artboard fits the FILE into the logo box,
     which shrinks the mark by however much padding it carries — a 1000px
     board holding an 80px mark arrived twelve pixels wide. */
  it("trims a logo's transparent surround at full resolution", async () => {
    const padded = logoPng({
      width: 400,
      height: 400,
      shape: "block",
      transparentMargin: 150,
    });
    getObjectBytes.mockResolvedValue(Buffer.from(padded));

    const { logo } = await loadBrandLogo(`${BASE}/logos/u1/a.png`);
    const decoded = logo && decodePngRgba(logo.bytes);
    expect(decoded).toMatchObject({ width: 100, height: 100 });
  });

  /* Either axis, not both. A wordmark that touches the left and right edges
     but carries vertical padding fills its width completely, and a max() test
     leaves that padding on — which is the exact shape trimming exists to
     remove. */
  it("trims a mark that fills its width but not its height", async () => {
    const width = 400;
    const height = 400;
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 150; y < 250; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 4;
        pixels[at] = 230;
        pixels[at + 1] = 30;
        pixels[at + 2] = 90;
        pixels[at + 3] = 255;
      }
    }
    getObjectBytes.mockResolvedValue(
      Buffer.from(encodePngRgba({ width, height, pixels })),
    );

    const { logo } = await loadBrandLogo(`${BASE}/logos/u1/a.png`);
    expect(decodePngRgba(logo?.bytes ?? new Uint8Array())).toMatchObject({
      width: 400,
      height: 100,
    });
  });

  it("leaves a logo that already fills its file alone", async () => {
    const tight = logoPng({ width: 120, height: 60, shape: "block" });
    getObjectBytes.mockResolvedValue(Buffer.from(tight));

    const { logo } = await loadBrandLogo(`${BASE}/logos/u1/a.png`);
    expect(logo?.bytes).toEqual(tight);
  });

  it("carries the probe's luminance through for the contrast decision", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(PNG));
    probeLogo.mockResolvedValue({
      drawable: true,
      darkest: 0.81,
      lightest: 0.81,
      aspect: 1,
    });
    const { logo } = await loadBrandLogo(`${BASE}/logos/u1/a.png`);
    expect(logo?.darkest).toBe(0.81);
  });

  /* The blocker: resvg skips an image node it cannot decode instead of
     throwing, so a damaged file rendered a design with an empty corner and
     every check called it a success. */
  it("reports a file the renderer silently declined to draw", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(PNG));
    probeLogo.mockResolvedValue({
      drawable: false,
      darkest: Number.NaN,
      lightest: Number.NaN,
      aspect: 1,
    });

    const { logo, fault } = await loadBrandLogo(`${BASE}/logos/u1/a.png`);
    expect(logo).toBeNull();
    expect(fault).toMatch(/could not decode it/);
  });

  it("checks the rasterised SVG, not the vector it came from", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(svg('viewBox="0 0 10 10"')));
    probeLogo.mockResolvedValue({
      drawable: false,
      darkest: Number.NaN,
      lightest: Number.NaN,
      aspect: 1,
    });

    const { logo, fault } = await loadBrandLogo(`${BASE}/logos/u1/a.svg`);
    expect(logo).toBeNull();
    expect(fault).toMatch(/could not decode it/);
    expect(probeLogo.mock.calls[0][0].bytes).toEqual(PNG);
  });

  it("reports a vector the renderer choked on", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(svg('viewBox="0 0 10 10"')));
    rasterizeSvg.mockRejectedValue(new Error("resvg"));
    const { logo, fault } = await loadBrandLogo(`${BASE}/logos/u1/a.svg`);
    expect(logo).toBeNull();
    expect(fault).toMatch(/could not be converted/);
  });
});

describe("loadBestLogo", () => {
  /* A brand can hold more than one approved mark. Which belongs on a given
     design is a contrast question, and the probe measures the number that
     answers it — rather than trusting a filename, where an inverted mark under
     a misleading name would be picked confidently and be invisible. */
  it("picks the mark that reads on a dark ground", async () => {
    const dark = logoPng({
      width: 64,
      height: 64,
      shape: "block",
      color: [10, 10, 12, 255],
    });
    const light = logoPng({
      width: 64,
      height: 64,
      shape: "block",
      color: [250, 250, 250, 255],
    });
    getObjectBytes.mockImplementation((key: string) =>
      Promise.resolve(Buffer.from(key.includes("dark") ? dark : light)),
    );
    probeLogo.mockImplementation((logo: { bytes: Uint8Array }) =>
      Promise.resolve({
        drawable: true,
        darkest: logo.bytes[100] < 128 ? 0.01 : 0.95,
        lightest: logo.bytes[100] < 128 ? 0.01 : 0.95,
        aspect: 1,
      }),
    );

    const { logo } = await loadBestLogo({
      urls: [`${BASE}/logos/u1/dark.png`, `${BASE}/logos/u1/light.png`],
      background: "#0F172A",
    });
    expect(logo?.lightest).toBe(0.95);
  });

  /* Ranking by the BEST-reading half picks the mark with a bright accent and
     a body that vanishes — the "white speck" the backing rule exists to
     prevent. The variant that wins has to be the one whose WORST half reads
     best, the same metric legibility uses. */
  it("prefers the mark whose weakest half reads, not its brightest", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(PNG));
    probeLogo.mockImplementation((logo: { bytes: Uint8Array }) =>
      Promise.resolve(
        logo.bytes[0] === 0x89 && probeLogo.mock.calls.length === 1
          ? // Candidate A: a dark body with a white speck. Its best half is
            // perfect on a dark ground; its body disappears.
            { drawable: true, darkest: 0.01, lightest: 1, aspect: 1 }
          : // Candidate B: an even mid-light mark, readable throughout.
            { drawable: true, darkest: 0.55, lightest: 0.62, aspect: 1 },
      ),
    );

    const { logo } = await loadBestLogo({
      urls: [`${BASE}/logos/u1/speck.png`, `${BASE}/logos/u1/even.png`],
      background: "#0F172A",
    });

    expect(logo?.darkest).toBe(0.55);
  });

  it("returns the only candidate when there is one", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(PNG));
    const { logo, fault } = await loadBestLogo({
      urls: [`${BASE}/logos/u1/a.png`, null, undefined],
      background: "#0F172A",
    });
    expect(logo).not.toBeNull();
    expect(fault).toBeNull();
  });

  it("reports nothing when the brand has no marks at all", async () => {
    expect(await loadBestLogo({ urls: [], background: "#000" })).toEqual({
      logo: null,
      fault: null,
    });
  });

  /* One broken file among several is not worth a notification: the design
     still gets a correct mark. */
  it("stays quiet when one candidate fails and another works", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(PNG));
    probeLogo.mockImplementationOnce(() =>
      Promise.resolve({
        drawable: false,
        darkest: Number.NaN,
        lightest: Number.NaN,
        aspect: 1,
      }),
    );

    const { logo, fault } = await loadBestLogo({
      urls: [`${BASE}/logos/u1/broken.png`, `${BASE}/logos/u1/ok.png`],
      background: "#0F172A",
    });
    expect(logo).not.toBeNull();
    expect(fault).toBeNull();
  });

  it("reports the real reason when every candidate fails", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(PNG));
    probeLogo.mockResolvedValue({
      drawable: false,
      darkest: Number.NaN,
      lightest: Number.NaN,
      aspect: 1,
    });

    const { logo, fault } = await loadBestLogo({
      urls: [`${BASE}/logos/u1/a.png`, `${BASE}/logos/u1/b.png`],
      background: "#0F172A",
    });
    expect(logo).toBeNull();
    expect(fault).toMatch(/could not decode it/);
  });
});

describe("the aspect the loader reports", () => {
  /* Read off the probe render, not the file header — a JPEG, a 16-bit PNG and
     an interlaced PNG all decode to nothing here and were silently called
     square, which shrank a 3:1 wordmark to 55% and turned its backing plate
     into a square slab. */
  it("comes from the probe, so it survives a format we cannot decode", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(JPEG));
    probeLogo.mockResolvedValue({
      drawable: true,
      darkest: 0.2,
      lightest: 0.2,
      aspect: 3,
    });

    const { logo } = await loadBrandLogo(`${BASE}/logos/u1/a.jpg`);
    expect(logo?.aspect).toBe(3);
  });

  it("is carried through variant selection too", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(PNG));
    probeLogo.mockResolvedValue({
      drawable: true,
      darkest: 0.2,
      lightest: 0.2,
      aspect: 2.5,
    });

    const { logo } = await loadBestLogo({
      urls: [`${BASE}/logos/u1/a.png`],
      background: "#0F172A",
    });
    expect(logo?.aspect).toBe(2.5);
  });

  /* The probe runs on the bytes the renderer will draw, so the aspect it
     reports is the cropped mark's, not the artboard's. */
  it("probes the cropped bytes, not the original", async () => {
    const padded = logoPng({
      width: 400,
      height: 400,
      shape: "block",
      transparentMargin: 150,
    });
    getObjectBytes.mockResolvedValue(Buffer.from(padded));

    const { logo } = await loadBrandLogo(`${BASE}/logos/u1/a.png`);
    const probed = probeLogo.mock.calls[0][0].bytes;
    expect(probed).toEqual(logo?.bytes);
    expect(decodePngRgba(probed)).toMatchObject({ width: 100, height: 100 });
  });
});

describe("formats we do not place", () => {
  /* detectImageType recognises GIF and WEBP, which are truthy and used to fall
     through to the probe and come back as "the file may be damaged" — about a
     file that is fine and simply not a container we can composite. */
  it.each([
    ["GIF", new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2])],
    [
      "WEBP",
      new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50,
      ]),
    ],
  ])("tells the truth about a %s", async (_label, bytes) => {
    getObjectBytes.mockResolvedValue(Buffer.from(bytes));

    const { logo, fault } = await loadBrandLogo(`${BASE}/logos/u1/a.png`);
    expect(logo).toBeNull();
    expect(fault).toMatch(/not a PNG, JPEG or SVG/);
    expect(fault).not.toMatch(/damaged/);
  });
});

describe("loadBestLogo does not fan out without limit", () => {
  it("probes the same object once however it is spelled", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(PNG));

    await loadBestLogo({
      urls: [
        `${BASE}/logos/u1/a.png`,
        `${BASE}/logos/u1/a.png?v=2`,
        `${BASE}/logos/u1/a.png`,
      ],
      background: "#0F172A",
    });

    expect(probeLogo).toHaveBeenCalledTimes(1);
  });

  /* Each candidate costs a fetch, a decode and a 512px render. */
  it("caps how many candidates it will consider", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(PNG));

    await loadBestLogo({
      urls: Array.from({ length: 40 }, (_, i) => `${BASE}/logos/u1/${i}.png`),
      background: "#0F172A",
    });

    expect(probeLogo.mock.calls.length).toBeLessThanOrEqual(8);
  });
});

describe("the aspect for a file the decoder cannot read", () => {
  /* cropToInk only reaches formats the decoder handles, so a 16-bit or
     interlaced PNG keeps its padding — and reporting the INK aspect for one of
     those sized the box for a wide mark and then contained a square file into
     it, drawing at under a third of the intended size. The header is readable
     even when the pixels are not. */
  function png16(width: number, height: number): Uint8Array {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    const crc = (b: Buffer) => {
      let x = 0xffffffff;
      for (const byte of b) x = table[(x ^ byte) & 0xff] ^ (x >>> 8);
      return (x ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length, 0);
      head.write(type, 4, "ascii");
      const tail = Buffer.alloc(4);
      tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
      return Buffer.concat([head, data, tail]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 16;
    ihdr[9] = 6;
    return new Uint8Array(
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(Buffer.alloc(height * (width * 8 + 1)))),
        chunk("IEND", Buffer.alloc(0)),
      ]),
    );
  }

  it("uses the declared size, not the ink, when it could not be trimmed", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from(png16(900, 300)));
    // The probe still draws it and reports the ink's shape.
    probeLogo.mockResolvedValue({
      drawable: true,
      darkest: 0.2,
      lightest: 0.2,
      aspect: 1,
    });

    const { logo } = await loadBrandLogo(`${BASE}/logos/u1/a.png`);
    // The renderer fits the whole FILE, so the file's 3:1 is what it needs.
    expect(logo?.aspect).toBe(3);
  });

  it("keeps the ink aspect once the file has been trimmed to it", async () => {
    getObjectBytes.mockResolvedValue(
      Buffer.from(
        logoPng({
          width: 400,
          height: 400,
          shape: "block",
          transparentMargin: 150,
        }),
      ),
    );
    probeLogo.mockResolvedValue({
      drawable: true,
      darkest: 0.2,
      lightest: 0.2,
      aspect: 1,
    });

    const { logo } = await loadBrandLogo(`${BASE}/logos/u1/a.png`);
    expect(logo?.aspect).toBe(1);
  });
});
