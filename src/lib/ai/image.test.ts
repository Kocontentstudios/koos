import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetch = vi.fn();
const mockAwsClient = vi.fn();

// Arrow functions can't be invoked via `new`, so the constructor stub must
// be a regular function for `new AwsClient(...)` to work under mockImplementation.
vi.mock("aws4fetch", () => ({
  AwsClient: vi.fn().mockImplementation(function AwsClientStub(
    ...args: unknown[]
  ) {
    mockAwsClient(...args);
    return { fetch: mockFetch };
  }),
}));

import { generateBrandImage } from "./image";

describe("generateBrandImage", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockAwsClient.mockReset();
    process.env.AWS_ACCESS_KEY_ID = "test-access-key";
    process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
    delete process.env.AWS_SESSION_TOKEN;
    delete process.env.AI_IMAGE_MODEL;
    delete process.env.AI_IMAGE_REGION;
  });

  it("returns decoded bytes and png content type from the Bedrock response", async () => {
    const expectedBytes = Buffer.from("x");
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          images: [expectedBytes.toString("base64")],
          finish_reasons: [null],
        }),
        { status: 200 },
      ),
    );

    const result = await generateBrandImage({ prompt: "hi" });

    expect(result.contentType).toBe("image/png");
    expect(Buffer.from(result.bytes)).toEqual(expectedBytes);
  });

  it("targets the Bedrock InvokeModel URL and sends the Stability request body", async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ images: [Buffer.from("x").toString("base64")] }),
        { status: 200 },
      ),
    );

    await generateBrandImage({ prompt: "a red logo" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(
      "https://bedrock-runtime.us-west-2.amazonaws.com/model/stability.stable-image-core-v1%3A1/invoke",
    );
    const body = JSON.parse(init.body as string);
    expect(body.prompt).toBe("a red logo");
    expect(body.mode).toBe("text-to-image");
    expect(body.aspect_ratio).toBe("1:1");
    expect(body.output_format).toBe("png");
  });

  it("signs requests with the Bedrock service name, not the endpoint prefix", async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ images: [Buffer.from("x").toString("base64")] }),
        { status: 200 },
      ),
    );

    await generateBrandImage({ prompt: "hi" });

    expect(mockAwsClient).toHaveBeenCalledTimes(1);
    const [config] = mockAwsClient.mock.calls[0];
    expect(config.service).toBe("bedrock");
    expect(config.region).toBe("us-west-2");
  });

  it("throws when Bedrock responds with a non-ok status", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "denied",
    });

    await expect(generateBrandImage({ prompt: "hi" })).rejects.toThrow(/403/);
  });

  it("rejects without calling fetch when AWS credentials are missing", async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;

    await expect(generateBrandImage({ prompt: "hi" })).rejects.toThrow(
      /AWS_ACCESS_KEY_ID/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
