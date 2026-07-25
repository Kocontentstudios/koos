import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getBrandForAdmin = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getBrandForAdmin: (id: string) => getBrandForAdmin(id),
}));

import { GET } from "./route";

const VALID_ID = "11111111-1111-1111-1111-111111111111";
const TRUSTED_ORIGIN = "https://cdn.test.example.com";

function req() {
  return new Request(`http://x/api/admin/brands/${VALID_ID}/logo`);
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function brandWithLogoUrl(logoUrl: string | null) {
  return {
    brand: { id: VALID_ID, name: "Acme Rockets", logoUrl },
    ownerEmail: "owner@example.com",
    workspaceName: "Acme Workspace",
  };
}

describe("admin brand logo route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("R2_PUBLIC_BASE_URL", TRUSTED_ORIGIN);
    vi.stubGlobal("fetch", vi.fn());
    getAuthUser.mockResolvedValue({ dbUser: { id: "a1", role: "admin" } });
  });

  it("returns 403 for a non-admin caller without calling fetch", async () => {
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1", role: "customer" } });
    const res = await GET(req(), params(VALID_ID));
    expect(res.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 404 for a non-uuid id", async () => {
    const res = await GET(req(), params("not-a-uuid"));
    expect(res.status).toBe(404);
    expect(getBrandForAdmin).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 404 when the brand has no logo on file", async () => {
    getBrandForAdmin.mockResolvedValue(brandWithLogoUrl(null));
    const res = await GET(req(), params(VALID_ID));
    expect(res.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 404 and never calls fetch for an untrusted logoUrl origin (SSRF guard)", async () => {
    getBrandForAdmin.mockResolvedValue(
      brandWithLogoUrl("http://169.254.169.254/x"),
    );
    const res = await GET(req(), params(VALID_ID));
    expect(res.status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("streams the logo with an attachment header for a trusted origin", async () => {
    getBrandForAdmin.mockResolvedValue(
      brandWithLogoUrl(`${TRUSTED_ORIGIN}/logos/x.png`),
    );
    vi.mocked(fetch).mockResolvedValue(
      new Response("bytes", {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );

    const res = await GET(req(), params(VALID_ID));
    expect(res.status).toBe(200);
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment;");
    expect(disposition).toContain("acme-rockets-logo.png");
  });

  it("returns 415 when the upstream content-type is not allow-listed", async () => {
    getBrandForAdmin.mockResolvedValue(
      brandWithLogoUrl(`${TRUSTED_ORIGIN}/logos/x.html`),
    );
    vi.mocked(fetch).mockResolvedValue(
      new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const res = await GET(req(), params(VALID_ID));
    expect(res.status).toBe(415);
  });

  it("returns 502 when the upstream fetch does not resolve ok", async () => {
    getBrandForAdmin.mockResolvedValue(
      brandWithLogoUrl(`${TRUSTED_ORIGIN}/logos/x.png`),
    );
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 500 }));

    const res = await GET(req(), params(VALID_ID));
    expect(res.status).toBe(502);
  });
});
