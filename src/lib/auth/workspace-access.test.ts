import { describe, expect, it } from "vitest";
import {
  type Capability,
  can,
  evaluateBrandAccess,
  isWorkspaceRole,
} from "./workspace-access";

const ALL: Capability[] = [
  "manage_content",
  "delete_content",
  "manage_team",
  "manage_settings",
  "delete_workspace",
];

describe("can", () => {
  it("owner has every capability", () => {
    for (const c of ALL) expect(can("owner", c)).toBe(true);
  });

  it("member has manage_content and nothing else", () => {
    expect(can("member", "manage_content")).toBe(true);
    for (const c of ALL.filter((c) => c !== "manage_content")) {
      expect(can("member", c)).toBe(false);
    }
  });
});

describe("isWorkspaceRole", () => {
  it("accepts owner/member, rejects everything else", () => {
    expect(isWorkspaceRole("owner")).toBe(true);
    expect(isWorkspaceRole("member")).toBe(true);
    expect(isWorkspaceRole("admin")).toBe(false);
    expect(isWorkspaceRole(null)).toBe(false);
  });
});

describe("evaluateBrandAccess", () => {
  const base = { brandId: "b1", restrictedBrandIds: [] as string[] };

  it("non-member gets 404 (no existence leak)", () => {
    const d = evaluateBrandAccess({
      ...base,
      membership: null,
      capability: "manage_content",
    });
    expect(d).toEqual({ ok: false, status: 404, error: "Brand not found" });
  });

  it("member with manage_content is allowed (default open)", () => {
    const d = evaluateBrandAccess({
      ...base,
      membership: { role: "member" },
      capability: "manage_content",
    });
    expect(d).toEqual({ ok: true });
  });

  it("member lacking the capability gets 403", () => {
    const d = evaluateBrandAccess({
      ...base,
      membership: { role: "member" },
      capability: "delete_content",
    });
    expect(d).toEqual({
      ok: false,
      status: 403,
      error: "You don't have permission to do that in this workspace.",
    });
  });

  it("member restricted to other brands gets 404 for this one", () => {
    const d = evaluateBrandAccess({
      brandId: "b1",
      restrictedBrandIds: ["b2", "b3"],
      membership: { role: "member" },
      capability: "manage_content",
    });
    expect(d).toEqual({ ok: false, status: 404, error: "Brand not found" });
  });

  it("member restricted to a list that includes this brand is allowed", () => {
    const d = evaluateBrandAccess({
      brandId: "b1",
      restrictedBrandIds: ["b1", "b3"],
      membership: { role: "member" },
      capability: "manage_content",
    });
    expect(d).toEqual({ ok: true });
  });

  it("owner ignores restriction rows entirely", () => {
    const d = evaluateBrandAccess({
      brandId: "b1",
      restrictedBrandIds: ["b2"],
      membership: { role: "owner" },
      capability: "delete_content",
    });
    expect(d).toEqual({ ok: true });
  });
});
