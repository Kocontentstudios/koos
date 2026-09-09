import { describe, expect, it } from "vitest";
import { normalizeHex } from "./hex";

describe("normalizeHex", () => {
  it("prefixes a missing #", () => {
    expect(normalizeHex("138BC8")).toBe("#138BC8");
  });
  it("expands 3-char shorthand to 6 and uppercases", () => {
    expect(normalizeHex("#fff")).toBe("#FFFFFF");
  });
  it("returns null for invalid input", () => {
    expect(normalizeHex("nope")).toBeNull();
  });
});
