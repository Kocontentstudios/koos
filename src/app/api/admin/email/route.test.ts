import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const verifyTransport = vi.fn();
const sendMail = vi.fn();
const checkRateLimit = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (p: unknown) => checkRateLimit(p),
  tooManyRequests: () => Response.json({ error: "Slow down" }, { status: 429 }),
}));
vi.mock("@/lib/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email")>();
  return {
    ...actual,
    verifyTransport: () => verifyTransport(),
    sendMail: (opts: unknown) => sendMail(opts),
  };
});

import { GET } from "./health/route";
import { POST } from "./test/route";

const ADMIN = { dbUser: { id: "u1", role: "admin" } };
const DESIGNER = { dbUser: { id: "u2", role: "designer" } };

function testReq(body: unknown, contentType = "application/json") {
  return new Request("http://x/api/admin/email/test", {
    method: "POST",
    headers: { "content-type": contentType },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  getAuthUser.mockResolvedValue(ADMIN);
  checkRateLimit.mockResolvedValue({ ok: true });
  verifyTransport.mockResolvedValue(true);
  sendMail.mockResolvedValue({ messageId: "1" });
  vi.stubEnv("ZOHO_SMTP_USER", "admin@kocontentstudios.com");
  vi.stubEnv("ZOHO_SMTP_PASS", "app-password");
  vi.stubEnv("ZOHO_MAIL_FROM", "admin@kocontentstudios.com");
});

describe("GET /api/admin/email/health", () => {
  it("is admin-only — a designer cannot read the environment", async () => {
    getAuthUser.mockResolvedValue(DESIGNER);
    expect((await GET()).status).toBe(403);
  });

  it("is admin-only — signed out is forbidden", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    expect((await GET()).status).toBe(403);
  });

  it("reports a live connection when the transport authenticates", async () => {
    const body = (await (await GET()).json()) as {
      configured: boolean;
      connection: { ok: boolean };
    };
    expect(body.configured).toBe(true);
    expect(body.connection.ok).toBe(true);
  });

  it("never returns a credential value", async () => {
    const raw = await (await GET()).text();
    expect(raw).not.toContain("app-password");
    expect(raw).not.toContain("admin@kocontentstudios.com");
  });

  it("skips the connection attempt when SMTP is unconfigured", async () => {
    vi.stubEnv("ZOHO_SMTP_PASS", "");
    const body = (await (await GET()).json()) as {
      connection: { kind: string };
    };
    expect(body.connection.kind).toBe("config");
    expect(verifyTransport).not.toHaveBeenCalled();
  });

  /* Every call opens a real SMTP AUTH, and the session cookie is sameSite=lax
     — an unlimited GET is an amplification vector into Zoho's throttling. */
  it("is rate limited", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 60 });
    expect((await GET()).status).toBe(429);
    expect(verifyTransport).not.toHaveBeenCalled();
  });

  it("reports the failure class instead of throwing", async () => {
    verifyTransport.mockRejectedValue(
      Object.assign(new Error("bad login"), { code: "EAUTH" }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const body = (await (await GET()).json()) as {
      connection: { ok: boolean; kind: string; detail: string };
    };
    expect(body.connection.ok).toBe(false);
    expect(body.connection.kind).toBe("auth");
    // The operator, not a tenant, is the audience here.
    expect(body.connection.detail).toContain("app password");
  });
});

describe("POST /api/admin/email/test", () => {
  it("is admin-only", async () => {
    getAuthUser.mockResolvedValue(DESIGNER);
    const res = await POST(testReq({ to: "a@b.com" }));
    expect(res.status).toBe(403);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("rejects a malformed address before sending", async () => {
    const res = await POST(testReq({ to: "nope" }));
    expect(res.status).toBe(400);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("sends the test message", async () => {
    const res = await POST(testReq({ to: "ops@example.com" }));
    expect(res.status).toBe(200);
    const sent = sendMail.mock.calls[0][0] as { to: string; html: string };
    expect(sent.to).toBe("ops@example.com");
    // The delivered mail names the host an invite would point at, which is the
    // other half of the staging failure.
    expect(sent.html).toContain("Invite links resolve to");
  });

  it("returns the actionable reason when the send is rejected", async () => {
    sendMail.mockRejectedValue(
      Object.assign(new Error("relay"), { responseCode: 553 }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(testReq({ to: "ops@example.com" }));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain(
      "ZOHO_MAIL_FROM",
    );
  });

  /* The session cookie is sameSite=lax, so a cross-site form post would
     otherwise reach here. A simple form cannot set application/json. */
  it("refuses a body that did not declare JSON", async () => {
    const res = await POST(testReq({ to: "a@b.com" }, "text/plain"));
    expect(res.status).toBe(415);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    checkRateLimit.mockResolvedValue({ ok: false, retryAfterSeconds: 60 });
    const res = await POST(testReq({ to: "ops@example.com" }));
    expect(res.status).toBe(429);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
