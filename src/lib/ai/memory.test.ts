import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/queries", () => ({
  getBrandMemory: vi.fn(),
  upsertBrandMemory: vi.fn(),
}));
vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("./provider", () => ({ getModel: vi.fn(() => "mock-model") }));

import { generateObject } from "ai";
import * as q from "@/lib/db/queries";
import { buildMemoryBlock, summarizeIntoMemory } from "./memory";

describe("memory", () => {
  it("buildMemoryBlock returns the stored summary", async () => {
    vi.mocked(q.getBrandMemory).mockResolvedValue({
      summary: "Sells shoes.",
      facts: [],
    });
    expect(await buildMemoryBlock("b1")).toContain("Sells shoes.");
  });

  it("buildMemoryBlock returns an empty string when there is no memory", async () => {
    vi.mocked(q.getBrandMemory).mockResolvedValue(null);
    expect(await buildMemoryBlock("b1")).toBe("");
  });

  it("buildMemoryBlock swallows errors (best-effort)", async () => {
    vi.mocked(q.getBrandMemory).mockRejectedValue(new Error("db down"));
    expect(await buildMemoryBlock("b1")).toBe("");
  });

  it("summarizeIntoMemory swallows errors (best-effort)", async () => {
    vi.mocked(q.getBrandMemory).mockRejectedValue(new Error("db down"));
    await expect(
      summarizeIntoMemory({
        brandId: "b1",
        userText: "hi",
        assistantText: "yo",
      }),
    ).resolves.toBeUndefined();
  });

  it("summarizeIntoMemory merges new facts and upserts", async () => {
    vi.mocked(q.getBrandMemory).mockResolvedValue({
      summary: "Old summary.",
      facts: [
        {
          text: "Old fact.",
          source: "chat",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    vi.mocked(generateObject).mockResolvedValue({
      object: { summary: "New summary.", newFacts: ["New fact."] },
    } as never);

    await summarizeIntoMemory({
      brandId: "b1",
      userText: "hi",
      assistantText: "yo",
    });

    expect(q.upsertBrandMemory).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({
        summary: "New summary.",
        facts: expect.arrayContaining([
          expect.objectContaining({ text: "Old fact." }),
          expect.objectContaining({ text: "New fact.", source: "chat" }),
        ]),
      }),
    );
  });
});
