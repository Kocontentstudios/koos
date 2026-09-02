import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateImage = vi.fn();

vi.mock("ai", () => ({
  generateImage: (opts: unknown) => generateImage(opts),
}));
vi.mock("@/lib/ai/google-transport", () => ({
  activeGoogleTransport: () => "vertex",
  googleImageModel: (id: string) => ({ id }),
  isGoogleConfigured: () => true,
}));

import { googleAdapter } from "@/lib/ai/image/adapters/google";

type Options = {
  aspectRatio: string;
  providerOptions: Record<string, { imageConfig: Record<string, string> }>;
};

function sent(): Options {
  return generateImage.mock.calls[0][0] as Options;
}

beforeEach(() => {
  vi.clearAllMocks();
  generateImage.mockResolvedValue({
    image: { uint8Array: new Uint8Array([1]), mediaType: "image/png" },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("googleAdapter size request", () => {
  /* Nano Banana Pro renders at 1K, 2K or 4K but returns the 1K default unless
     asked. Nothing asked, so every design so far came back at 1K — and the
     size is invisible in the output, so nothing failed. */
  it("asks for 2K by default", async () => {
    await googleAdapter.generate({ prompt: "p", aspectRatio: "1:1" });
    expect(sent().providerOptions.google.imageConfig.imageSize).toBe("2K");
  });

  /* Vertex reads `vertex`, AI Studio reads `google`; each ignores the other's,
     and the transport is chosen at runtime. */
  it("sets the size under both provider keys", async () => {
    await googleAdapter.generate({ prompt: "p", aspectRatio: "1:1" });
    const { providerOptions } = sent();
    expect(providerOptions.vertex.imageConfig.imageSize).toBe("2K");
    expect(providerOptions.google.imageConfig.imageSize).toBe("2K");
  });

  it("honours an explicit override", async () => {
    vi.stubEnv("AI_DESIGN_GOOGLE_IMAGE_SIZE", "4K");
    await googleAdapter.generate({ prompt: "p", aspectRatio: "1:1" });
    expect(sent().providerOptions.google.imageConfig.imageSize).toBe("4K");
  });

  /* An unvalidated typo would make every generation fall back to the default
     size for the life of the process, with only a log line to say so. */
  it("ignores a value the provider does not accept", async () => {
    vi.stubEnv("AI_DESIGN_GOOGLE_IMAGE_SIZE", "2k");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await googleAdapter.generate({ prompt: "p", aspectRatio: "1:1" });
    expect(sent().providerOptions.google.imageConfig.imageSize).toBe("2K");
    expect(warn).toHaveBeenCalled();
  });

  /* The outer argument takes an enum with no 4:5, but imageConfig accepts it —
     and the caller's imageConfig replaces the SDK's, so the true ratio has to
     be repeated here or portrait silently renders as 3:4. */
  it("keeps the true 4:5 ratio in imageConfig", async () => {
    await googleAdapter.generate({ prompt: "p", aspectRatio: "4:5" });
    const { aspectRatio, providerOptions } = sent();
    expect(aspectRatio).toBe("3:4");
    expect(providerOptions.google.imageConfig.aspectRatio).toBe("4:5");
  });

  it("still passes reference images through", async () => {
    const reference = { bytes: new Uint8Array([9]), contentType: "image/png" };
    await googleAdapter.generate({
      prompt: "p",
      aspectRatio: "1:1",
      referenceImages: [reference],
    });
    const call = generateImage.mock.calls[0][0] as { prompt: unknown };
    expect(JSON.stringify(call.prompt)).toContain("images");
  });
});
