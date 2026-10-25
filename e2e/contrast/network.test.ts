// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isNetworkBlip, networkCut } from "./network";

describe("isNetworkBlip", () => {
  it("names the line round 5's clean run failed on", () => {
    expect(
      isNetworkBlip(
        "Failed to load resource: net::ERR_NETWORK_CHANGED (http://localhost:3101/_next/static/chunks/app/layout.js)",
      ),
    ).toBe(true);
  });

  it("leaves the page's own failures to fail the pass", () => {
    for (const text of [
      "Failed to load resource: the server responded with a status of 500 (Internal Server Error)",
      "Failed to load resource: net::ERR_CONNECTION_REFUSED",
      "ChunkLoadError: Loading chunk app/layout failed.",
      "uncaught: TypeError: Cannot read properties of undefined",
    ]) {
      expect(isNetworkBlip(text)).toBe(false);
    }
  });
});

describe("networkCut", () => {
  const CUT =
    "Failed to load resource: net::ERR_NETWORK_CHANGED (http://localhost:3101/_next/static/chunks/app/layout.js)";

  it("reloads once for a cut on the first load", () => {
    expect(networkCut(CUT, { loaded: false, reloaded: false })).toBe("reload");
  });

  it("fails the pass when the reload is cut too", () => {
    expect(networkCut(CUT, { loaded: false, reloaded: true })).toBe("fail");
  });

  it("fails the pass for a cut after the first load finished", () => {
    expect(networkCut(CUT, { loaded: true, reloaded: false })).toBe("fail");
  });

  it("leaves every other line to the other rules", () => {
    expect(
      networkCut("Failed to load resource: net::ERR_CONNECTION_REFUSED", {
        loaded: false,
        reloaded: false,
      }),
    ).toBe("other");
  });
});
