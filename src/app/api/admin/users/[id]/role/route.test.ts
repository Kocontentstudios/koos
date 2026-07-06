import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getUserById = vi.fn();
const updateUserRole = vi.fn();
const sendRoleChangeEmail = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getUserById: (id: string) => getUserById(id),
  updateUserRole: (id: string, role: unknown) => updateUserRole(id, role),
}));
vi.mock("@/lib/notify/account", () => ({
  sendRoleChangeEmail: (a: unknown) => sendRoleChangeEmail(a),
}));
vi.mock("@/lib/design/notify", () => ({
  appUrl: (p: string) => `https://app${p}`,
}));

import { POST } from "./route";

const target = {
  id: "u2",
  role: "user",
  firstName: "Jane",
  lastName: "Doe",
  email: "jane@x.com",
};

function req(body: unknown) {
  return new Request("http://x", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: "u2" }) };

describe("admin role route emails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "a1", role: "admin" } });
    getUserById.mockResolvedValue(target);
    updateUserRole.mockResolvedValue({ ...target, role: "designer" });
  });

  it("emails the target user when an admin changes their role", async () => {
    const res = await POST(req({ role: "designer" }), params);
    expect(res.status).toBe(200);
    expect(sendRoleChangeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "jane@x.com",
        input: expect.objectContaining({ newRole: "designer" }),
      }),
    );
  });

  it("still emails when the role is unchanged", async () => {
    updateUserRole.mockResolvedValue({ ...target, role: "user" });
    const res = await POST(req({ role: "user" }), params);
    expect(res.status).toBe(200);
    expect(sendRoleChangeEmail).toHaveBeenCalled();
  });

  it("still returns 200 when the email helper rejects", async () => {
    sendRoleChangeEmail.mockRejectedValue(new Error("smtp down"));
    const res = await POST(req({ role: "designer" }), params);
    expect(res.status).toBe(200);
  });

  it("sends no email for a non-admin caller (403)", async () => {
    getAuthUser.mockResolvedValue({ dbUser: { id: "u3", role: "customer" } });
    const res = await POST(req({ role: "designer" }), params);
    expect(res.status).toBe(403);
    expect(sendRoleChangeEmail).not.toHaveBeenCalled();
  });
});
