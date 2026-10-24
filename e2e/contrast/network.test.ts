// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isNetworkBlip } from "./network";

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
