import { describe, expect, it } from "vitest";
import { resolveImageConfig } from "./image-config";

describe("resolveImageConfig", () => {
  it("defaults to bedrock stable-image-core us-west-2", () => {
    expect(resolveImageConfig({})).toEqual({
      provider: "bedrock",
      model: "stability.stable-image-core-v1:1",
      region: "us-west-2",
    });
  });
  it("honors env overrides", () => {
    expect(
      resolveImageConfig({
        AI_IMAGE_PROVIDER: "bedrock",
        AI_IMAGE_MODEL: "stability.stable-image-ultra-v1:1",
        AI_IMAGE_REGION: "us-east-1",
      }),
    ).toEqual({
      provider: "bedrock",
      model: "stability.stable-image-ultra-v1:1",
      region: "us-east-1",
    });
  });
});
