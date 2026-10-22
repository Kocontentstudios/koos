import { describe, expect, it } from "vitest";
import {
  isCanonicalKey,
  keyUnderPrefix,
  STORAGE_PREFIXES,
} from "./storage-keys";

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

describe("isCanonicalKey", () => {
  it.each([
    "logos/u1/1729500000000-a1b2c3d4e5f6.png",
    "design-images/b1/f00d.jpg",
    "generated/b1/plates/p_1.png",
    "reference-images/u1/abc.webp",
  ])("accepts %s, the shape every upload path writes", (key) => {
    expect(isCanonicalKey(key)).toBe(true);
  });

  /* B2: anything a URL parser would read as a scheme, host, query, fragment,
     encoded path or dot segment, and invisible characters that make two
     keys look the same. */
  it.each([
    "logos/%2e%2e/deliverables/u1/x.zip",
    "logos/",
    "logos",
    "logos//evil.example/x",
    "logos/https://evil.example/x.png",
    "logos/a?x=1",
    "logos/a#y",
    "logos/a‮b.png",
    "logos/./x.png",
    "logos/../x.png",
    "logos/b1/..",
    "/logos/b1/x.png",
    ".logos/b1/x.png",
    "logos/b 1/x.png",
    "",
  ])("refuses %j", (key) => {
    expect(isCanonicalKey(key)).toBe(false);
  });
});
