// @vitest-environment node
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (a: unknown) => generateObject(a) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

const { lookAtPhoto } = await import("./plate-check");

const photo = new Uint8Array(
  await sharp({
    create: { width: 1400, height: 1000, channels: 3, background: "#6b625a" },
  })
    .png()
    .toBuffer(),
);

/* The 16:14:41 UTC cafe look: two people in the photo, no head boxed. */
const CAFE_LOOK = {
  mainSubject: "an espresso bar",
  subjectBox: { left: 18, top: 28, right: 82, bottom: 82 },
  isPerson: false,
  faceBox: null,
  visibleItems: ["an espresso machine", "stacked cups", "a barista"],
  heads: [],
};

beforeEach(() => {
  generateObject.mockReset();
});

describe("round 25, CB2: a look of people with no heads", () => {
  it("asks once more for heads alone, and takes what it boxes", async () => {
    generateObject
      .mockResolvedValueOnce({ object: { ...CAFE_LOOK, anyPerson: true } })
      .mockResolvedValueOnce({
        object: { heads: [{ left: 58, top: 16, right: 77, bottom: 40 }] },
      });
    const look = await lookAtPhoto(photo);
    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(generateObject.mock.calls[1][0].system).toMatch(/heads/);
    expect(look?.peopleVisible).toBe(true);
    expect(look?.headsAskedAgain).toBe(true);
    expect(look?.heads).toHaveLength(1);
  });

  it("returns no heads when the second ask boxes none either", async () => {
    generateObject
      .mockResolvedValueOnce({ object: { ...CAFE_LOOK, anyPerson: true } })
      .mockResolvedValueOnce({ object: { heads: [] } });
    const look = await lookAtPhoto(photo);
    expect(generateObject).toHaveBeenCalledTimes(2);
    expect(look?.peopleVisible).toBe(true);
    expect(look?.heads).toEqual([]);
  });

  it("returns no heads when the second ask fails, never throwing the look away", async () => {
    generateObject
      .mockResolvedValueOnce({ object: { ...CAFE_LOOK, anyPerson: true } })
      .mockRejectedValueOnce(new Error("throttled"));
    const look = await lookAtPhoto(photo);
    expect(look?.subject).not.toBeNull();
    expect(look?.peopleVisible).toBe(true);
    expect(look?.heads).toEqual([]);
  });

  it("reads people from the look's own list when it leaves anyPerson out", async () => {
    generateObject
      .mockResolvedValueOnce({ object: CAFE_LOOK })
      .mockResolvedValueOnce({ object: { heads: [] } });
    const look = await lookAtPhoto(photo);
    expect(look?.peopleVisible).toBe(true);
    expect(look?.headsAskedAgain).toBe(true);
  });

  it("asks nothing more of a photo with no people, or with heads boxed", async () => {
    generateObject.mockResolvedValueOnce({
      object: {
        ...CAFE_LOOK,
        visibleItems: ["an espresso machine", "stacked cups"],
        anyPerson: false,
      },
    });
    const empty = await lookAtPhoto(photo);
    expect(empty?.peopleVisible).toBe(false);
    expect(empty?.headsAskedAgain).toBe(false);
    generateObject.mockResolvedValueOnce({
      object: {
        ...CAFE_LOOK,
        anyPerson: true,
        heads: [{ left: 58, top: 16, right: 77, bottom: 40 }],
      },
    });
    const boxed = await lookAtPhoto(photo);
    expect(boxed?.headsAskedAgain).toBe(false);
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("asks the look whether any person appears", async () => {
    generateObject.mockResolvedValueOnce({
      object: { ...CAFE_LOOK, anyPerson: false, visibleItems: [] },
    });
    await lookAtPhoto(photo);
    const schema = generateObject.mock.calls[0][0].schema;
    expect(Object.keys(schema.shape)).toContain("anyPerson");
    expect(generateObject.mock.calls[0][0].system).toMatch(
      /whether any person appears/,
    );
  });
});
