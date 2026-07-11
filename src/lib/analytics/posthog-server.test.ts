import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captureImmediate = vi.fn().mockResolvedValue(undefined);
const PostHogMock = vi.fn(function (this: {
  captureImmediate: typeof captureImmediate;
}) {
  this.captureImmediate = captureImmediate;
});

vi.mock("posthog-node", () => ({ PostHog: PostHogMock }));

describe("captureServerEvent", () => {
  beforeEach(() => {
    vi.resetModules();
    PostHogMock.mockClear();
    captureImmediate.mockClear();
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
  });

  it("is a no-op when NEXT_PUBLIC_POSTHOG_KEY is unset", async () => {
    const { captureServerEvent } = await import("./posthog-server");
    await captureServerEvent({ distinctId: "u1", event: "signed_up" });
    expect(PostHogMock).not.toHaveBeenCalled();
    expect(captureImmediate).not.toHaveBeenCalled();
  });

  it("captures with distinctId, event, and properties when configured", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    const { captureServerEvent } = await import("./posthog-server");
    await captureServerEvent({
      distinctId: "u1",
      event: "strategy_generated",
      properties: { brand_id: "b1" },
    });
    expect(PostHogMock).toHaveBeenCalledTimes(1);
    expect(captureImmediate).toHaveBeenCalledWith({
      distinctId: "u1",
      event: "strategy_generated",
      properties: { brand_id: "b1" },
    });
  });

  it("reuses one client across calls and never throws on capture errors", async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    captureImmediate.mockRejectedValueOnce(new Error("network down"));
    const { captureServerEvent } = await import("./posthog-server");
    await expect(
      captureServerEvent({ distinctId: "u1", event: "signed_up" }),
    ).resolves.toBeUndefined();
    await captureServerEvent({ distinctId: "u2", event: "signed_up" });
    expect(PostHogMock).toHaveBeenCalledTimes(1);
    expect(captureImmediate).toHaveBeenCalledTimes(2);
  });
});
