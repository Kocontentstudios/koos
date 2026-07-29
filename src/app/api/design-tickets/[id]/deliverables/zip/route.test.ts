import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const getDesignTicketById = vi.fn();
const getDeliverables = vi.fn();
const getObjectBytes = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (userId: string, brandId: string, capability: string) =>
    checkBrandAccess(userId, brandId, capability),
  getDesignTicketById: (id: string) => getDesignTicketById(id),
  getDeliverables: (ticketId: string) => getDeliverables(ticketId),
}));
vi.mock("@/lib/storage", () => ({
  getObjectBytes: (key: string) => getObjectBytes(key),
}));

import { GET } from "./route";

const ticket = {
  id: "t1",
  ticketNumber: 42,
  userId: "u1",
  brandId: "b1",
  status: "ready_for_review",
};
const deliverable = {
  id: "d1",
  ticketId: "t1",
  fileUrl: "deliverables/t1/file.png",
  fileName: "file.png",
};

function req() {
  return new Request("http://x/api/design-tickets/t1/deliverables/zip");
}
const params = { params: Promise.resolve({ id: "t1" }) };

function mockOwnerWithAccess() {
  getAuthUser.mockResolvedValue({ dbUser: { id: "u1", role: "member" } });
  checkBrandAccess.mockResolvedValue({ ok: true, brand: { id: "b1" } });
}

function mockStaff() {
  getAuthUser.mockResolvedValue({
    dbUser: { id: "designer1", role: "designer" },
  });
  checkBrandAccess.mockResolvedValue({ ok: false });
}

function mockTicket(overrides: Partial<typeof ticket> = {}) {
  getDesignTicketById.mockResolvedValue({ ...ticket, ...overrides });
}

describe("GET zip download route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDeliverables.mockResolvedValue([deliverable]);
    getObjectBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
  });

  it("blocks download before approval for a non-staff owner", async () => {
    mockOwnerWithAccess();
    mockTicket({ status: "ready_for_review" });
    const res = await GET(req(), params);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "Approve the design to download it." });
  });

  it("allows download once the ticket is delivered", async () => {
    mockOwnerWithAccess();
    mockTicket({ status: "delivered" });
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
  });

  it("allows staff to download before approval", async () => {
    mockStaff();
    mockTicket({ status: "ready_for_review" });
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
  });
});
