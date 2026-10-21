import { describe, expect, it } from "vitest";
import { keyUnderPrefix, STORAGE_PREFIXES } from "./storage-keys";

describe("keyUnderPrefix", () => {
  it("accepts a key under the prefix", () => {
    expect(keyUnderPrefix("logos/u1/a.png", STORAGE_PREFIXES.logos)).toBe(
      "logos/u1/a.png",
    );
  });

  it("accepts any of several prefixes", () => {
    const allowed = [STORAGE_PREFIXES.generated, STORAGE_PREFIXES.designImages];
    expect(keyUnderPrefix("design-images/b1/x.png", allowed)).toBe(
      "design-images/b1/x.png",
    );
    expect(keyUnderPrefix("generated/b1/p.png", allowed)).toBe(
      "generated/b1/p.png",
    );
  });

  it("refuses a sibling prefix that merely starts with the same letters", () => {
    expect(
      keyUnderPrefix("logos-private/u1/a.png", STORAGE_PREFIXES.logos),
    ).toBeNull();
  });

  it("refuses traversal out of the prefix", () => {
    expect(
      keyUnderPrefix("logos/../deliverables/u2/a.png", STORAGE_PREFIXES.logos),
    ).toBeNull();
  });

  it("refuses a key that is only the prefix", () => {
    expect(keyUnderPrefix("logos", STORAGE_PREFIXES.logos)).toBeNull();
  });
});
