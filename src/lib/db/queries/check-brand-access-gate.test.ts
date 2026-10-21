import { beforeEach, describe, expect, it, vi } from "vitest";

/* checkBrandAccess runs several queries in sequence (brand+workspace,
   membership, then the user's role only when the workspace is pending). This
   stand-in answers each awaited query with the next queued result, and records
   how many were asked, so a test can prove the role lookup is skipped. */
const { dbProxy, queue, asked } = vi.hoisted(() => {
  const queue: unknown[][] = [];
  const asked = { count: 0 };
  function chain(): unknown {
    const node: unknown = new Proxy(() => {}, {
      get: (_t, prop) => {
        if (prop === "then") {
          asked.count += 1;
          const rows = queue.shift() ?? [];
          return (resolve: (v: unknown) => void) => resolve(rows);
        }
        return () => node;
      },
    });
    return node;
  }
  return {
    queue,
    asked,
    dbProxy: { select: () => chain() },
  };
});

vi.mock("@/lib/db/client", () => ({ db: dbProxy }));

import { WORKSPACE_PENDING_ERROR } from "@/lib/auth/workspace-approval";
import { checkBrandAccess } from "./workspaces";

const BRAND = { id: "b1", workspaceId: "w1", name: "Killa" };
const OWNER = { id: "m1", role: "owner", brandScope: "all" };

function given(...results: unknown[][]) {
  queue.length = 0;
  queue.push(...results);
}

describe("checkBrandAccess and the access gate", () => {
  beforeEach(() => {
    asked.count = 0;
  });

  it("opens an approved workspace's brand without a role lookup", async () => {
    given([{ brand: BRAND, accessStatus: "approved" }], [OWNER]);
    const out = await checkBrandAccess("u1", "b1", "manage_content");
    expect(out).toEqual({ ok: true, brand: BRAND });
    expect(asked.count).toBe(2);
  });

  it("403s a client on a pending workspace's brand", async () => {
    given(
      [{ brand: BRAND, accessStatus: "pending" }],
      [OWNER],
      [{ role: "user" }],
    );
    const out = await checkBrandAccess("u1", "b1", "manage_content");
    expect(out).toEqual({
      ok: false,
      status: 403,
      error: WORKSPACE_PENDING_ERROR,
    });
  });

  it("lets staff act on a pending workspace's brand", async () => {
    given(
      [{ brand: BRAND, accessStatus: "pending" }],
      [OWNER],
      [{ role: "admin" }],
    );
    const out = await checkBrandAccess("u1", "b1", "manage_content");
    expect(out.ok).toBe(true);
  });

  it("fails closed when the user row has vanished", async () => {
    given([{ brand: BRAND, accessStatus: "pending" }], [OWNER], []);
    const out = await checkBrandAccess("u1", "b1", "manage_content");
    expect(out.ok).toBe(false);
  });

  /* Approval must never turn "not yours" into "yours but pending": the 404
     comes first so a stranger learns nothing about another workspace. */
  it("still 404s a non-member before it considers approval", async () => {
    given([{ brand: BRAND, accessStatus: "pending" }], []);
    const out = await checkBrandAccess("stranger", "b1", "manage_content");
    expect(out).toEqual({ ok: false, status: 404, error: "Brand not found" });
    expect(asked.count).toBe(2);
  });

  it("404s a brand that does not exist", async () => {
    given([]);
    const out = await checkBrandAccess("u1", "nope", "manage_content");
    expect(out).toEqual({ ok: false, status: 404, error: "Brand not found" });
  });
});
