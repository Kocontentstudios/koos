// @vitest-environment node
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (a: unknown) => generateObject(a) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

const { checkPlateShowsProduct, lookAtPhoto, subjectBoxFrom } = await import(
  "./plate-check"
);

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
    expect(verdict).toEqual({
      shows: true,
      seen: "a slice of mille-feuille",
      subject: null,
      items: [],
      lettering: false,
      person: false,
      anyPerson: false,
    });
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
    ).toMatchObject({ shows: false, seen: "a round strawberry tart" });
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

/* Round-4 live critic: a sourdough class was checked as an object, and
   two right plates were rejected twice. */
describe("an event or a service", () => {
  it("is checked for a scene that fits it, not for an object", async () => {
    generateObject.mockResolvedValue({
      object: {
        mainSubject: "teens kneading dough at a floured bench",
        fitsBrief: true,
        identifiablePerson: true,
      },
    });
    const verdict = await checkPlateShowsProduct({
      bytes: plate,
      product: "teen sourdough baking class",
      look: "",
      kind: "event",
    });
    expect(verdict).toMatchObject({ shows: true, person: true });
    const [text] = sent().messages[0].content;
    expect(text.text).toContain(
      "The brief promotes this event: teen sourdough baking class.",
    );
    expect(sent().system).toContain("whether the scene fits it");
  });

  it("reports a scene of something else", async () => {
    generateObject.mockResolvedValue({
      object: { mainSubject: "a bowl of fruit", fitsBrief: false },
    });
    expect(
      await checkPlateShowsProduct({
        bytes: plate,
        product: "teen sourdough baking class",
        look: "",
        kind: "event",
      }),
    ).toMatchObject({ shows: false, seen: "a bowl of fruit" });
  });
});

describe("the plate look's other answers", () => {
  /* Round-2 live run: "ZOBO / MIOCZEBC PRALEF" on the bottle. */
  it("reports lettering and the subject's box in the same call", async () => {
    generateObject.mockResolvedValue({
      object: {
        mainSubject: "a bottle of zobo",
        showsProduct: true,
        subjectBox: { left: 30, top: 20, right: 70, bottom: 90 },
        visibleItems: ["a bottle of zobo", "ice", "hibiscus flowers"],
        lettering: true,
      },
    });
    const verdict = await checkPlateShowsProduct({
      bytes: plate,
      product: "zobo hibiscus cooler",
      look: "",
    });
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(verdict).toMatchObject({
      shows: true,
      lettering: true,
      items: ["a bottle of zobo", "ice", "hibiscus flowers"],
    });
    expect(verdict?.subject?.x).toBeCloseTo(0.28);
    expect(verdict?.subject?.w).toBeCloseTo(0.44);
    expect(sent().system).toContain("made-up brand names");
  });

  it("still looks for the subject and lettering when no product is named", async () => {
    generateObject.mockResolvedValue({
      object: {
        mainSubject: "a stage",
        showsProduct: false,
        subjectBox: { left: 10, top: 10, right: 50, bottom: 50 },
        visibleItems: [],
        lettering: false,
      },
    });
    const verdict = await checkPlateShowsProduct({
      bytes: plate,
      product: "",
      look: "",
    });
    expect(verdict?.shows).toBe(true);
    expect(sent().messages[0].content[0].text).toContain("No product is named");
  });
});

describe("subjectBoxFrom", () => {
  it("turns percent into shares with a little room around it", () => {
    expect(
      subjectBoxFrom({ left: 10, top: 20, right: 60, bottom: 80 }),
    ).toEqual({
      x: expect.closeTo(0.08),
      y: expect.closeTo(0.18),
      w: expect.closeTo(0.54),
      h: expect.closeTo(0.64),
    });
  });

  it("reads shares sent despite the instruction, and swapped edges", () => {
    expect(
      subjectBoxFrom({ left: 0.6, top: 0.8, right: 0.1, bottom: 0.2 }),
    ).toEqual({
      x: expect.closeTo(0.08),
      y: expect.closeTo(0.18),
      w: expect.closeTo(0.54),
      h: expect.closeTo(0.64),
    });
  });

  it("refuses a box that is no box", () => {
    expect(subjectBoxFrom({ left: 10, top: 10, right: 10, bottom: 90 })).toBe(
      null,
    );
    expect(
      subjectBoxFrom({ left: Number.NaN, top: 0, right: 1, bottom: 1 }),
    ).toBe(null);
    expect(subjectBoxFrom(null)).toBe(null);
  });
});

describe("lookAtPhoto", () => {
  it("boxes the subject and, for a person, the head and shoulders", async () => {
    generateObject.mockResolvedValue({
      object: {
        mainSubject: "a woman in a linen dress",
        subjectBox: { left: 25, top: 5, right: 75, bottom: 100 },
        isPerson: true,
        faceBox: { left: 38, top: 5, right: 62, bottom: 30 },
        visibleItems: ["a woman", "a linen dress", "a grey wall"],
      },
    });
    const look = await lookAtPhoto(plate);
    expect(look?.description).toContain("a woman in a linen dress");
    expect(look?.subject?.h).toBeCloseTo(0.97);
    expect(look?.face?.y).toBeCloseTo(0.03);
  });

  it("is null when the model cannot answer", async () => {
    generateObject.mockRejectedValue(new Error("throttled"));
    expect(await lookAtPhoto(plate)).toBeNull();
  });
});

/* Round-5 live critic: an AI woman in profile stood beside "architect Ada
   Obi" and was not an identifiable face. Any person is now reported. */
describe("any person on a plate", () => {
  it("reports a person who is not an identifiable face", async () => {
    generateObject.mockResolvedValue({
      object: {
        mainSubject: "a lecture hall",
        showsProduct: true,
        identifiablePerson: false,
        anyPerson: true,
      },
    });
    const verdict = await checkPlateShowsProduct({
      bytes: plate,
      product: "",
      look: "",
    });
    expect(verdict).toMatchObject({ person: false, anyPerson: true });
  });

  it("counts an identifiable face as a person too", async () => {
    generateObject.mockResolvedValue({
      object: {
        mainSubject: "a speaker",
        showsProduct: true,
        identifiablePerson: true,
      },
    });
    const verdict = await checkPlateShowsProduct({
      bytes: plate,
      product: "",
      look: "",
    });
    expect(verdict).toMatchObject({ person: true, anyPerson: true });
  });
});
