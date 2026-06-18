import { describe, expect, it } from "vitest";
import { isRole, ROLES } from "./roles";

describe("isRole", () => {
  it("accepts the three valid roles", () => {
    for (const r of ROLES) expect(isRole(r)).toBe(true);
  });
  it("rejects unknown values", () => {
    expect(isRole("superadmin")).toBe(false);
    expect(isRole("")).toBe(false);
    expect(isRole(null)).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(123)).toBe(false);
  });
});
