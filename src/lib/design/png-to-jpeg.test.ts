import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JPEG_QUALITY, jpegFileName, pngToJpeg, saveBlob } from "./png-to-jpeg";

/* jsdom has no canvas, so the 2D context records what was drawn, in order.
   The order is the point: white must be painted before the PNG, or the PNG's
   transparent pixels encode as black. */
interface Recorded {
  calls: string[];
  fillStyleAtFill: string | null;
  canvas: { width: number; height: number } | null;
  toBlobArgs: [string, number] | null;
}

let recorded: Recorded;
let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
const realCreateElement = document.createElement.bind(document);

beforeEach(() => {
  recorded = {
    calls: [],
    fillStyleAtFill: null,
    canvas: null,
    toBlobArgs: null,
  };
  bitmap = { width: 2160, height: 2700, close: vi.fn() };
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap),
  );
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "canvas") return realCreateElement(tag);
    const ctx = {
      fillStyle: "#000000",
      fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
        recorded.calls.push(`fill ${x},${y},${w},${h}`);
        recorded.fillStyleAtFill = ctx.fillStyle;
      }),
      drawImage: vi.fn(
        (_img: unknown, x: number, y: number, w: number, h: number) => {
          recorded.calls.push(`draw ${x},${y},${w},${h}`);
        },
      ),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (cb: (b: Blob | null) => void, type: string, q: number) => {
        recorded.canvas = { width: canvas.width, height: canvas.height };
        recorded.toBlobArgs = [type, q];
        cb(new Blob(["jpeg"], { type }));
      },
    };
    return canvas as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const png = new Blob(["png"], { type: "image/png" });

describe("pngToJpeg", () => {
  it("paints white before the PNG so alpha never turns black", async () => {
    await pngToJpeg(png, { width: 1080, height: 1350 });
    expect(recorded.fillStyleAtFill).toBe("#ffffff");
    expect(recorded.calls).toEqual([
      "fill 0,0,1080,1350",
      "draw 0,0,1080,1350",
    ]);
  });

  it("exports a JPEG at the design's own pixel size", async () => {
    const jpeg = await pngToJpeg(png, { width: 1080, height: 1350 });
    expect(recorded.canvas).toEqual({ width: 1080, height: 1350 });
    expect(recorded.toBlobArgs).toEqual(["image/jpeg", JPEG_QUALITY]);
    expect(jpeg.type).toBe("image/jpeg");
  });

  it("uses the decoded size when the row stored none", async () => {
    await pngToJpeg(png, null);
    expect(recorded.canvas).toEqual({ width: 2160, height: 2700 });
  });

  it("releases the decoded bitmap even when encoding fails", async () => {
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
      tag === "canvas"
        ? ({ getContext: () => null } as unknown as HTMLCanvasElement)
        : realCreateElement(tag)) as typeof document.createElement);
    await expect(pngToJpeg(png, null)).rejects.toThrow();
    expect(bitmap.close).toHaveBeenCalled();
  });
});

describe("saveBlob", () => {
  it("clicks a same-origin blob link carrying the file name", () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    saveBlob(new Blob(["x"]), "design.jpg");
    const link = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(link.download).toBe("design.jpg");
    expect(link.href).toBe("blob:fake");
  });
});

describe("jpegFileName", () => {
  it("swaps the extension", () => {
    expect(jpegFileName("instagram-post-1080x1350-ab12cd34.png")).toBe(
      "instagram-post-1080x1350-ab12cd34.jpg",
    );
  });
});
