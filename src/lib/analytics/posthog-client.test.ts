import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.fn();
const identify = vi.fn();
const reset = vi.fn();
const getDistinctId = vi.fn(() => "anon-abc");

vi.mock("posthog-js", () => ({
  default: {
    init,
    identify,
    reset,
    get_distinct_id: getDistinctId,
  },
}));

async function load() {
  return import("./posthog-client");
}

describe("posthog client", () => {
  beforeEach(() => {
    vi.resetModules();
    init.mockClear();
    identify.mockClear();
    reset.mockClear();
    getDistinctId.mockClear();
    getDistinctId.mockReturnValue("anon-abc");
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
  });

  describe("without a key", () => {
    it("reports analytics as disabled", async () => {
      const { isAnalyticsEnabled } = await load();
      expect(isAnalyticsEnabled()).toBe(false);
    });

    it("never initializes the SDK", async () => {
      const { ensureInit } = await load();
      expect(ensureInit()).toBe(false);
      expect(init).not.toHaveBeenCalled();
    });

    it("does not identify", async () => {
      const { identifyUser } = await load();
      identifyUser("user-1");
      expect(identify).not.toHaveBeenCalled();
    });

    it("does not reset", async () => {
      const { resetIdentity } = await load();
      resetIdentity();
      expect(reset).not.toHaveBeenCalled();
    });
  });

  describe("with a key", () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
    });

    it("reports analytics as enabled", async () => {
      const { isAnalyticsEnabled } = await load();
      expect(isAnalyticsEnabled()).toBe(true);
    });

    it("initializes once no matter how many callers ask", async () => {
      const { ensureInit } = await load();
      expect(ensureInit()).toBe(true);
      ensureInit();
      ensureInit();
      expect(init).toHaveBeenCalledTimes(1);
    });

    /* PageviewTracker captures $pageview by hand on every route change. If
       automatic capture were ever switched on, every pageview would double. */
    it("leaves automatic pageview capture off", async () => {
      const { ensureInit } = await load();
      ensureInit();
      expect(init).toHaveBeenCalledWith(
        "phc_test",
        expect.objectContaining({ capture_pageview: false }),
      );
    });

    it("defaults the host to US cloud", async () => {
      const { ensureInit } = await load();
      ensureInit();
      expect(init).toHaveBeenCalledWith(
        "phc_test",
        expect.objectContaining({ api_host: "https://us.i.posthog.com" }),
      );
    });

    it("honours an explicit host", async () => {
      process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://eu.i.posthog.com";
      const { ensureInit } = await load();
      ensureInit();
      expect(init).toHaveBeenCalledWith(
        "phc_test",
        expect.objectContaining({ api_host: "https://eu.i.posthog.com" }),
      );
    });

    it("initializes on demand when identifying before any pageview", async () => {
      const { identifyUser } = await load();
      identifyUser("user-1");
      expect(init).toHaveBeenCalledTimes(1);
      expect(identify).toHaveBeenCalledWith("user-1");
    });

    /* posthog-js only merges anonymous into known while the distinct_id is
       still the generated one, and re-identifying emits a redundant $identify
       on every navigation. */
    it("does not re-identify a browser already on that id", async () => {
      getDistinctId.mockReturnValue("user-1");
      const { identifyUser } = await load();
      identifyUser("user-1");
      expect(identify).not.toHaveBeenCalled();
    });

    it("identifies when the browser is on a different id", async () => {
      getDistinctId.mockReturnValue("anon-abc");
      const { identifyUser } = await load();
      identifyUser("user-1");
      expect(identify).toHaveBeenCalledWith("user-1");
    });

    it("ignores an empty user id rather than aliasing to nothing", async () => {
      const { identifyUser } = await load();
      identifyUser("");
      expect(identify).not.toHaveBeenCalled();
      expect(init).not.toHaveBeenCalled();
    });

    it("sends no person properties, so no PII leaves for a third party", async () => {
      const { identifyUser } = await load();
      identifyUser("user-1");
      expect(identify).toHaveBeenCalledWith("user-1");
      expect(identify.mock.calls[0]).toHaveLength(1);
    });

    it("resets identity once the SDK is running", async () => {
      const { ensureInit, resetIdentity } = await load();
      ensureInit();
      resetIdentity();
      expect(reset).toHaveBeenCalledTimes(1);
    });

    /* Calling into an uninitialized posthog throws, and a logout can happen
       before any tracked navigation on the page. */
    it("does not reset when the SDK never initialized", async () => {
      const { resetIdentity } = await load();
      resetIdentity();
      expect(reset).not.toHaveBeenCalled();
    });
  });
});
