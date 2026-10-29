// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (a: unknown) => generateObject(a) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "strategy-model" }));

const { askVision, imageMediaType, withTimeout } = await import("./vision");
const { z } = await import("zod");

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44,
  0x52, 0, 0, 0, 4, 0, 0, 0, 4,
]);

beforeEach(() => generateObject.mockReset());

describe("imageMediaType", () => {
  it("reads the type from the bytes, not a label", () => {
    expect(imageMediaType(PNG)).toBe("image/png");
    expect(imageMediaType(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("withTimeout", () => {
  it("names the caller when it gives up", async () => {
    await expect(
      withTimeout(new Promise(() => {}), 10, "plate check"),
    ).rejects.toThrow("plate check timed out after 10ms");
  });
});

describe("askVision", () => {
  it("asks the reasoning model, with the picture after the words", async () => {
    generateObject.mockResolvedValue({ object: { ok: true } });
    const answer = await askVision({
      schema: z.object({ ok: z.boolean() }),
      system: "sys",
      text: "question",
      image: { bytes: PNG, mediaType: "image/png" },
      maxOutputTokens: 50,
      timeoutMs: 1000,
      label: "test",
    });
    expect(answer).toEqual({ ok: true });
    const sent = generateObject.mock.calls[0][0];
    expect(sent.model).toBe("strategy-model");
    expect(sent.messages[0].content).toEqual([
      { type: "text", text: "question" },
      { type: "image", image: PNG, mediaType: "image/png" },
    ]);
  });

  it("sends words alone when there is no picture", async () => {
    generateObject.mockResolvedValue({ object: { ok: false } });
    await askVision({
      schema: z.object({ ok: z.boolean() }),
      system: "sys",
      text: "question",
      image: null,
      maxOutputTokens: 50,
      timeoutMs: 1000,
      label: "test",
    });
    expect(generateObject.mock.calls[0][0].messages[0].content).toHaveLength(1);
  });
});
