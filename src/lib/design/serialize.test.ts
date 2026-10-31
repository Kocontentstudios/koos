import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  publicUrl: (key: string) => `https://cdn.example/${key}`,
  getSignedReadUrl: vi.fn(),
}));

vi.stubEnv("R2_PUBLIC_BASE_URL", "https://cdn.example");
afterAll(() => {
  vi.unstubAllEnvs();
});

const { serializeGeneration } = await import("./serialize");

const row = {
  id: "g1",
  brandId: "b1",
  userId: "u1",
  source: "quick",
  briefId: null,
  calendarItemId: null,
  designType: "Instagram Post",
  attachments: [],
  spec: { headline: "Fresh croissants" },
  renderer: "composite",
  provider: "upload",
  model: "none",
  imageKey: "generated/b1/x.png",
  width: 1080,
  height: 1350,
  status: "succeeded",
  error: null,
  document: null,
  rationale: null,
  imageSource: null,
  sourceImageKey: null,
  createdAt: new Date("2026-10-21T06:00:00Z"),
} as const;

describe("serializeGeneration", () => {
  it("marks a row from before FEAT-033 as a non-editable variant", async () => {
    const out = await serializeGeneration(row as never);
    expect(out).toMatchObject({
      direction: null,
      imageSource: null,
      editable: false,
      headline: "Fresh croissants",
    });
  });

  it("exposes a direction's name and reasons, and nothing else of the rationale", async () => {
    const out = await serializeGeneration({
      ...row,
      document: { version: 1, elements: [] },
      rationale: {
        title: "Morning bake story",
        reasons: ["Leads with the croissant", "Warm ground"],
        set: "s1",
        slot: 0,
      },
      imageSource: "upload",
    } as never);
    expect(out.direction).toEqual({
      title: "Morning bake story",
      reasons: ["Leads with the croissant", "Warm ground"],
    });
    expect(out.imageSource).toBe("upload");
    expect(out.editable).toBe(true);
  });

  it("treats a malformed rationale as no direction rather than throwing", async () => {
    const out = await serializeGeneration({
      ...row,
      rationale: { title: 7 },
    } as never);
    expect(out.direction).toBeNull();
  });
});
