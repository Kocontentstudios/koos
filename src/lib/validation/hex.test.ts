import { describe, expect, it } from "vitest";
import { isValidHex, normalizeHex } from "./hex";

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
describe("isValidHex", () => {
  it("accepts #RGB and #RRGGBB (any case)", () => {
    expect(isValidHex("#fff")).toBe(true);
    expect(isValidHex("#138BC8")).toBe(true);
  });
  it("rejects invalid", () => {
    expect(isValidHex("#12")).toBe(false);
    expect(isValidHex("red")).toBe(false);
  });
});
