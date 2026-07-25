import { describe, expect, it } from "vitest";
import { isTrustedStorageUrl } from "./logo-proxy";

const BASE = "https://cdn.koos.example.com";

describe("isTrustedStorageUrl", () => {
  it("accepts a URL under the configured storage base", () => {
    expect(isTrustedStorageUrl(`${BASE}/logos/u1/abc.png`, BASE)).toBe(true);
  });
  it("rejects a different host", () => {
    expect(isTrustedStorageUrl("https://evil.example.com/x.png", BASE)).toBe(
      false,
    );
  });
  it("rejects a look-alike suffix host", () => {
    expect(
      isTrustedStorageUrl("https://cdn.koos.example.com.evil.com/x.png", BASE),
    ).toBe(false);
  });
  it("rejects internal and link-local addresses", () => {
    expect(
      isTrustedStorageUrl("http://169.254.169.254/latest/meta-data/", BASE),
    ).toBe(false);
    expect(isTrustedStorageUrl("http://localhost/x", BASE)).toBe(false);
  });
  it("rejects the right host over the wrong protocol", () => {
    expect(isTrustedStorageUrl("http://cdn.koos.example.com/x.png", BASE)).toBe(
      false,
    );
  });
  it("rejects a malformed url", () => {
    expect(isTrustedStorageUrl("not a url", BASE)).toBe(false);
  });
  it("rejects when no storage base is configured", () => {
    expect(isTrustedStorageUrl(`${BASE}/x.png`, undefined)).toBe(false);
  });
});
