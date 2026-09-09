import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkRateLimit = vi.fn();
const requestVerification = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (p: unknown) => checkRateLimit(p),
}));
vi.mock("@/lib/auth/session", () => ({
  deleteSessionCookie: vi.fn(),
  invalidateUserSessions: vi.fn(),
  startSession: vi.fn(),
}));
vi.mock("@/lib/auth/password", () => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock("@/lib/db/queries", () => ({
  createEmailVerificationToken: vi.fn(),
  createPasswordResetToken: vi.fn(),
  createUser: vi.fn(),
  getUserByEmail: vi.fn(),
  consumeEmailVerificationToken: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  createWorkspace: vi.fn(),
  getOrCreatePersonalWorkspaceId: vi.fn(),
  getPasswordResetTokenByHash: vi.fn(),
  markPasswordResetTokenUsed: vi.fn(),
  updateUserPassword: vi.fn(),
}));
vi.mock("@/lib/analytics/posthog-server", () => ({
  captureServerEvent: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/notify/account", () => ({
  sendVerificationEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));
/* requestVerification is the seam that matters: it writes the token row and
   THEN sends, both inside the action's single try block. */
vi.mock("@/lib/auth/email-verification", () => ({
  requestVerification: (deps: unknown, user: unknown) =>
    requestVerification(deps, user),
}));

import { MailSendError } from "@/lib/email";
import { resendVerificationEmail } from "./actions";

const USER = { id: "u1", email: "a@b.com", emailVerifiedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUser.mockResolvedValue({ dbUser: USER });
  checkRateLimit.mockResolvedValue({ ok: true });
  requestVerification.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("resendVerificationEmail", () => {
  it("sends for a signed-in unverified user", async () => {
    expect(await resendVerificationEmail()).toEqual({ ok: true });
  });

  it("requires a session", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    expect(await resendVerificationEmail()).toEqual({
      error: "You need to be signed in.",
    });
    expect(requestVerification).not.toHaveBeenCalled();
  });

  it("is a no-op once verified", async () => {
    getAuthUser.mockResolvedValue({
      dbUser: { ...USER, emailVerifiedAt: new Date() },
    });
    expect(await resendVerificationEmail()).toEqual({ ok: true });
    expect(requestVerification).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    checkRateLimit.mockResolvedValue({ ok: false });
    expect(await resendVerificationEmail()).toEqual({
      error: "Too many requests. Please try again in a bit.",
    });
  });

  it("describes a real mail failure", async () => {
    requestVerification.mockRejectedValue(
      new MailSendError(Object.assign(new Error("t"), { code: "ETIMEDOUT" })),
    );
    const result = await resendVerificationEmail();
    expect(result).toEqual({
      error: expect.stringContaining("could not reach our email service"),
    });
  });

  /* sendAccountVerificationEmail writes the token row BEFORE it sends, so a
     database outage lands in the same catch. postgres.js rejects with
     ECONNREFUSED, which looks exactly like an SMTP connection failure — only
     a tagged failure may be described as an email problem. */
  it("does not blame email for a database failure", async () => {
    requestVerification.mockRejectedValue(
      Object.assign(new Error("write CONNECT"), { code: "ECONNREFUSED" }),
    );
    const result = await resendVerificationEmail();
    expect(result).toEqual({
      error: "Could not send the verification email. Please try again.",
    });
  });

  it("never names our provider or environment to the user", async () => {
    requestVerification.mockRejectedValue(
      new MailSendError(
        Object.assign(new Error("relay"), { responseCode: 553 }),
      ),
    );
    const result = await resendVerificationEmail();
    expect((result as { error: string }).error).not.toMatch(
      /ZOHO|SMTP|redeploy|2FA/i,
    );
  });
});
