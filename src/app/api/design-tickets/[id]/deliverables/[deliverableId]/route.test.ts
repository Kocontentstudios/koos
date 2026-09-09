import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const getDesignTicketById = vi.fn();
const getDeliverableById = vi.fn();
const getSignedReadUrl = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (userId: string, brandId: string, capability: string) =>
    checkBrandAccess(userId, brandId, capability),
  getDesignTicketById: (id: string) => getDesignTicketById(id),
  getDeliverableById: (id: string) => getDeliverableById(id),
}));
vi.mock("@/lib/storage", () => ({
  getSignedReadUrl: (key: string, expiresIn: number, opts?: unknown) =>
    getSignedReadUrl(key, expiresIn, opts),
}));

import { GET } from "./route";

const ticket = {
  id: "t1",
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
};

function req(query = "") {
  return new Request(`http://x/api/design-tickets/t1/deliverables/d1${query}`);
}
const params = {
  params: Promise.resolve({ id: "t1", deliverableId: "d1" }),
};

function mockOwnerWithAccess() {
  getAuthUser.mockResolvedValue({ dbUser: { id: "u1", role: "user" } });
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

describe("GET deliverable download route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDeliverableById.mockResolvedValue(deliverable);
    getSignedReadUrl.mockResolvedValue("https://signed.example/file.png");
  });

  // Downloads wait on sign-off so a request can't quietly end with the client
  // taking the files and never closing the loop.
  it("blocks download before approval for a non-staff owner", async () => {
    mockOwnerWithAccess();
    mockTicket({ status: "ready_for_review" });
    const res = await GET(req("?disposition=attachment"), params);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: "Approve the design to download it." });
  });

  it("unlocks download once the client is satisfied", async () => {
    mockOwnerWithAccess();
    mockTicket({ status: "delivered", approvedAt: new Date() });
    const res = await GET(req("?disposition=attachment"), params);
    expect(res.status).toBe(302);
    expect(getSignedReadUrl).toHaveBeenCalledWith(deliverable.fileUrl, 300, {
      disposition: "attachment",
      fileName: deliverable.fileName,
    });
  });

  // Approval is sticky: a correction round reopens the review but must not
  // claw back files the client already earned.
  it("keeps download open when a later round reopens an approved ticket", async () => {
    mockOwnerWithAccess();
    mockTicket({ status: "ready_for_review", approvedAt: new Date() });
    const res = await GET(req("?disposition=attachment"), params);
    expect(res.status).toBe(302);
  });

  it("allows download before approval for staff", async () => {
    mockStaff();
    mockTicket({ status: "ready_for_review" });
    const res = await GET(req("?disposition=attachment"), params);
    expect(res.status).toBe(302);
    expect(getSignedReadUrl).toHaveBeenCalledWith(deliverable.fileUrl, 300, {
      disposition: "attachment",
      fileName: deliverable.fileName,
    });
  });

  it("allows inline view before approval for the owner", async () => {
    mockOwnerWithAccess();
    mockTicket({ status: "ready_for_review" });
    const res = await GET(req("?disposition=inline"), params);
    expect(res.status).toBe(302);
    expect(getSignedReadUrl).toHaveBeenCalledWith(deliverable.fileUrl, 300, {
      disposition: "inline",
      fileName: deliverable.fileName,
    });
  });

  it("defaults to inline view when no disposition param is given", async () => {
    mockOwnerWithAccess();
    mockTicket({ status: "ready_for_review" });
    const res = await GET(req(), params);
    expect(res.status).toBe(302);
    expect(getSignedReadUrl).toHaveBeenCalledWith(deliverable.fileUrl, 300, {
      disposition: "inline",
      fileName: deliverable.fileName,
    });
  });

  it("allows download once the ticket is delivered", async () => {
    mockOwnerWithAccess();
    mockTicket({ status: "delivered", approvedAt: new Date() });
    const res = await GET(req("?disposition=attachment"), params);
    expect(res.status).toBe(302);
    expect(getSignedReadUrl).toHaveBeenCalledWith(deliverable.fileUrl, 300, {
      disposition: "attachment",
      fileName: deliverable.fileName,
    });
  });
});
