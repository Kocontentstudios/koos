import { describe, expect, it } from "vitest";
import { isValidEmail } from "./email";

describe("isValidEmail", () => {
  it("accepts a normal address", () => {
    expect(isValidEmail("ada@example.com")).toBe(true);
    expect(isValidEmail("  ada@example.com  ")).toBe(true);
  });
  it("rejects malformed addresses", () => {
    for (const bad of [
      "",
      "ada",
      "ada@",
      "@example.com",
      "a b@x.com",
      "ada@example",
    ]) {
      expect(isValidEmail(bad)).toBe(false);
    }
  });
});
