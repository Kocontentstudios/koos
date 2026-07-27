import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const addBrandAsset = vi.fn();
const publicUrl = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (userId: string, brandId: string, capability: string) =>
    checkBrandAccess(userId, brandId, capability),
  addBrandAsset: (data: unknown) => addBrandAsset(data),
}));
vi.mock("@/lib/storage", () => ({
  publicUrl: (key: string) => publicUrl(key),
  STORAGE_PREFIXES: { generated: "generated" },
}));

import { POST } from "./route";

describe("design generated save-asset route", () => {
  const BRAND_ID = "11111111-1111-4111-8111-111111111111";
  const KEY = `generated/${BRAND_ID}/abc123.png`;

  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
    checkBrandAccess.mockResolvedValue({
      ok: true,
      brand: { id: BRAND_ID, userId: "u1", name: "Acme" },
    });
    addBrandAsset.mockResolvedValue({
      id: "asset1",
      brandId: BRAND_ID,
      assetType: "image",
      fileUrl: KEY,
      fileName: "abc123.png",
    });
    publicUrl.mockReturnValue(`https://cdn.example.com/${KEY}`);
    delete process.env.R2_PUBLIC_BASE_URL;
  });

  function request(body: unknown) {
    return new Request("http://x/api/design/generated/save-asset", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it("rejects unauthenticated requests with 401", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    const res = await POST(
      request({ brandId: BRAND_ID, key: KEY, fileName: "abc123.png" }),
    );
    expect(res.status).toBe(401);
    expect(addBrandAsset).not.toHaveBeenCalled();
  });

  it("rejects an invalid body with 400", async () => {
    const res = await POST(
      request({ brandId: "not-a-uuid", key: KEY, fileName: "abc123.png" }),
    );
    expect(res.status).toBe(400);
    expect(addBrandAsset).not.toHaveBeenCalled();
  });

  it("returns the access-check status and does not insert when access is denied", async () => {
    checkBrandAccess.mockResolvedValue({
      ok: false,
      status: 404,
      error: "Brand not found",
    });
    const res = await POST(
      request({ brandId: BRAND_ID, key: KEY, fileName: "abc123.png" }),
    );
    expect(res.status).toBe(404);
    expect(addBrandAsset).not.toHaveBeenCalled();
  });

  it("rejects a key that is not under this brand's generated prefix with 400", async () => {
    const otherBrandKey = `generated/22222222-2222-4222-8222-222222222222/abc123.png`;
    const res = await POST(
      request({
        brandId: BRAND_ID,
        key: otherBrandKey,
        fileName: "abc123.png",
      }),
    );
    expect(res.status).toBe(400);
    expect(addBrandAsset).not.toHaveBeenCalled();
  });

  it("saves a valid generated key as an image asset and returns 200", async () => {
    const res = await POST(
      request({ brandId: BRAND_ID, key: KEY, fileName: "abc123.png" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { asset: unknown };
    expect(body.asset).toBeTruthy();
    expect(addBrandAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        brandId: BRAND_ID,
        assetType: "image",
        fileName: "abc123.png",
      }),
    );
  });

  it("returns a clean 500 when the insert fails", async () => {
    addBrandAsset.mockRejectedValue(new Error("db exploded"));
    const res = await POST(
      request({ brandId: BRAND_ID, key: KEY, fileName: "abc123.png" }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });
});
