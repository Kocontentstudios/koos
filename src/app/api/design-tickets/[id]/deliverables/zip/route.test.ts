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
  approvedAt: null as Date | null,
};
const deliverable = {
  id: "d1",
  ticketId: "t1",
  fileUrl: "deliverables/t1/file.png",
  fileName: "file.png",
  version: 1,
  createdAt: new Date("2026-08-01T00:00:00Z"),
};
const revisedDeliverable = {
  id: "d2",
  ticketId: "t1",
  fileUrl: "deliverables/t1/file-v2.png",
  fileName: "file-v2.png",
  version: 2,
  createdAt: new Date("2026-08-05T00:00:00Z"),
};

function req(query = "") {
  return new Request(`http://x/api/design-tickets/t1/deliverables/zip${query}`);
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

  // Downloads wait on sign-off so a request can't quietly end with the client
  // taking the files and never closing the loop.
  it("blocks download before approval for a non-staff owner", async () => {
    mockOwnerWithAccess();
    mockTicket({ status: "ready_for_review" });
    const res = await GET(req(), params);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "Approve the design to download it." });
  });

  it("zips the latest round by default", async () => {
    mockOwnerWithAccess();
    mockTicket({ status: "delivered", approvedAt: new Date() });
    getDeliverables.mockResolvedValue([deliverable, revisedDeliverable]);
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain(
      "DT-00042-v2-deliverables.zip",
    );
    expect(getObjectBytes).toHaveBeenCalledTimes(1);
    expect(getObjectBytes).toHaveBeenCalledWith(revisedDeliverable.fileUrl);
  });

  // Approving the newest round unlocks the whole history, so a client can still
  // retrieve the version they preferred.
  it("zips an earlier round when asked for it by version", async () => {
    mockOwnerWithAccess();
    mockTicket({ status: "delivered", approvedAt: new Date() });
    getDeliverables.mockResolvedValue([deliverable, revisedDeliverable]);
    const res = await GET(req("?version=1"), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain(
      "DT-00042-v1-deliverables.zip",
    );
    expect(getObjectBytes).toHaveBeenCalledWith(deliverable.fileUrl);
  });

  it("rejects a non-numeric version", async () => {
    mockOwnerWithAccess();
    mockTicket({ status: "delivered", approvedAt: new Date() });
    const res = await GET(req("?version=latest"), params);
    expect(res.status).toBe(400);
  });

  it("404s for a version that was never delivered", async () => {
    mockOwnerWithAccess();
    mockTicket({ status: "delivered", approvedAt: new Date() });
    const res = await GET(req("?version=9"), params);
    expect(res.status).toBe(404);
  });

  it("allows download once the client is satisfied", async () => {
    mockOwnerWithAccess();
    mockTicket({ status: "delivered", approvedAt: new Date() });
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
  });

  // Approval is sticky: a correction round reopens the review but must not
  // claw back files the client already earned.
  it("keeps download open when a later round reopens an approved ticket", async () => {
    mockOwnerWithAccess();
    mockTicket({ status: "ready_for_review", approvedAt: new Date() });
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
