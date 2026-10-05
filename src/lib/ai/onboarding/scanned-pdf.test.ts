import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({
  generateObject: (opts: unknown) => generateObject(opts),
}));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

import { MAX_VISION_PDF_BYTES, readScannedPdf } from "./scanned-pdf";

type Call = {
  maxOutputTokens?: number;
  system?: string;
  messages?: {
    content: (
      | { type: "text"; text: string }
      | { type: "file"; data: Uint8Array; mediaType: string }
    )[];
  }[];
};

const lastCall = () => generateObject.mock.calls[0]?.[0] as Call | undefined;
const partsOf = () => lastCall()?.messages?.[0]?.content ?? [];
const pdf = (size = 1_000) => Buffer.alloc(size, 7);

describe("readScannedPdf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateObject.mockResolvedValue({
      object: { summary: "A coffee roaster", fields: { name: "Okra Kitchen" } },
    });
  });

  /* A scanned brand deck has no text layer, so the bytes themselves have to
     reach the model. Handing it a description of the file, or its name, would
     extract nothing (KOOS-V1-FEAT-031). */
  it("sends the document itself, as a PDF", async () => {
    await readScannedPdf({ bytes: pdf(), fileName: "brand.pdf" });

    const file = partsOf().find((p) => p.type === "file");
    expect(file).toBeDefined();
    expect(file).toMatchObject({ mediaType: "application/pdf" });
  });

  it("returns what the model found", async () => {
    generateObject.mockResolvedValue({
      object: {
        summary: "A coffee roaster",
        fields: { name: "Okra Kitchen", tone: "Warm" },
      },
    });

    await expect(
      readScannedPdf({ bytes: pdf(), fileName: "brand.pdf" }),
    ).resolves.toMatchObject({
      summary: "A coffee roaster",
      fields: { name: "Okra Kitchen", tone: "Warm" },
    });
  });

  /* Reads the scan alongside what the user has already typed, exactly as the
     text path does — the chat is context, not a competing source. */
  it("carries the conversation so far", async () => {
    await readScannedPdf({
      bytes: pdf(),
      fileName: "brand.pdf",
      conversation: "user: We are Okra Kitchen.",
    });

    const text = partsOf()
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("\n");
    expect(text).toContain("Okra Kitchen");
  });

  /* Not every provider accepts document parts — an openai-compatible endpoint
     pointed at a text-only model rejects them outright. The user must get the
     existing "this looks like a scan" message, never a stack trace. */
  it("returns null when the provider cannot read documents", async () => {
    generateObject.mockRejectedValue(new Error("unsupported content type"));

    await expect(
      readScannedPdf({ bytes: pdf(), fileName: "brand.pdf" }),
    ).resolves.toBeNull();
  });

  /* Provider document limits sit well below the 25MB upload cap, and a refusal
     that costs nothing beats a 25MB round trip that fails. */
  it("refuses an oversized PDF without calling the model", async () => {
    await expect(
      readScannedPdf({
        bytes: pdf(MAX_VISION_PDF_BYTES + 1),
        fileName: "huge.pdf",
      }),
    ).resolves.toBeNull();
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("accepts a PDF exactly at the limit", async () => {
    await readScannedPdf({
      bytes: pdf(MAX_VISION_PDF_BYTES),
      fileName: "big.pdf",
    });

    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  /* Unbounded output truncates mid-JSON on Bedrock and surfaces as "did not
     match schema" — the same cap the text path uses. */
  it("caps the output tokens", async () => {
    await readScannedPdf({ bytes: pdf(), fileName: "brand.pdf" });

    expect(lastCall()?.maxOutputTokens).toBeGreaterThan(0);
  });

  it("drops fields the model left empty rather than writing blanks", async () => {
    generateObject.mockResolvedValue({
      object: {
        summary: "A coffee roaster",
        fields: { name: "Okra Kitchen", tone: "", targetAudience: "   " },
      },
    });

    const result = await readScannedPdf({
      bytes: pdf(),
      fileName: "brand.pdf",
    });

    expect(result?.fields).toEqual({ name: "Okra Kitchen" });
  });

  it("returns null when the model finds nothing usable", async () => {
    generateObject.mockResolvedValue({
      object: { summary: "", fields: { name: "", tone: "" } },
    });

    await expect(
      readScannedPdf({ bytes: pdf(), fileName: "brand.pdf" }),
    ).resolves.toBeNull();
  });
});
