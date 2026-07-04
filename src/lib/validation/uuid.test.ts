import { describe, expect, it } from "vitest";
import { isUuid } from "./uuid";

describe("isUuid", () => {
  it("accepts a canonical v4 UUID", () => {
    expect(isUuid("3f2504e0-4f89-41d3-9a0c-0305e82c3301")).toBe(true);
  });
  it("accepts crypto.randomUUID() output", () => {
    expect(isUuid(crypto.randomUUID())).toBe(true);
  });
  it("rejects malformed strings", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("12345")).toBe(false);
    expect(isUuid("3f2504e0-4f89-41d3-9a0c")).toBe(false);
  });
});
