// @vitest-environment node
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (a: unknown) => generateObject(a) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

const { checkPlateShowsProduct } = await import("./plate-check");

const plate = new Uint8Array(
  await sharp({
    create: { width: 1600, height: 2000, channels: 3, background: "#d94" },
  })
    .png()
    .toBuffer(),
);

type Sent = {
  system: string;
  messages: {
    content: {
      type: string;
      text?: string;
      image?: Uint8Array;
      mediaType?: string;
    }[];
  }[];
};
const sent = () => generateObject.mock.calls[0][0] as Sent;

beforeEach(() => {
  generateObject.mockReset();
});

describe("checkPlateShowsProduct", () => {
  it("asks the reasoning model about the product, with the plate attached small", async () => {
    generateObject.mockResolvedValue({
      object: { mainSubject: "a slice of mille-feuille", showsProduct: true },
    });
    const verdict = await checkPlateShowsProduct({
      bytes: plate,
      product: "strawberry mille-feuille",
      look: "three layers of puff pastry with cream and strawberries",
    });
    expect(verdict).toEqual({ shows: true, seen: "a slice of mille-feuille" });
    const [text, image] = sent().messages[0].content;
    expect(text.text).toContain("The product: strawberry mille-feuille.");
    expect(text.text).toContain("three layers of puff pastry");
    expect(image.mediaType).toBe("image/jpeg");
    const meta = await sharp(image.image as Uint8Array).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(768);
    expect(sent().system).toContain("a tart for a mille-feuille");
  });

  it("reports what it saw when the plate shows something else", async () => {
    generateObject.mockResolvedValue({
      object: { mainSubject: "a round strawberry tart", showsProduct: false },
    });
    expect(
      await checkPlateShowsProduct({
        bytes: plate,
        product: "strawberry mille-feuille",
        look: "",
      }),
    ).toEqual({ shows: false, seen: "a round strawberry tart" });
  });

  it("is null, never a verdict, when the model cannot answer", async () => {
    generateObject.mockRejectedValue(new Error("throttled"));
    expect(
      await checkPlateShowsProduct({
        bytes: plate,
        product: "strawberry mille-feuille",
        look: "",
      }),
    ).toBeNull();
  });

  it("is null for bytes that are not an image", async () => {
    expect(
      await checkPlateShowsProduct({
        bytes: new Uint8Array([1, 2, 3]),
        product: "x",
        look: "",
      }),
    ).toBeNull();
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("gives up at its timeout instead of holding the job", async () => {
    generateObject.mockReturnValue(new Promise(() => {}));
    expect(
      await checkPlateShowsProduct({
        bytes: plate,
        product: "x",
        look: "",
        timeoutMs: 20,
      }),
    ).toBeNull();
  });
});
