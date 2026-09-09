import { beforeEach, describe, expect, it, vi } from "vitest";

const guardWorkspaceRoute = vi.fn();
const requireVerifiedEmail = vi.fn();
const checkRateLimit = vi.fn();
const resendInvitation = vi.fn();
const getInvitationById = vi.fn();
const can = vi.fn();

vi.mock("@/lib/auth/workspace-guard", () => ({
  guardWorkspaceRoute: (perms: string[]) => guardWorkspaceRoute(perms),
}));
vi.mock("@/lib/auth/require-verified-email", () => ({
  requireVerifiedEmail: (u: unknown) => requireVerifiedEmail(u),
}));
vi.mock("@/lib/auth/workspace-access", () => ({
  can: (role: string, perm: string) => can(role, perm),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (p: unknown) => checkRateLimit(p),
  tooManyRequests: () => Response.json({ error: "Slow down" }, { status: 429 }),
}));
vi.mock("@/lib/db/queries", () => ({
  getInvitationById: (id: string) => getInvitationById(id),
  rotateInvitationToken: vi.fn(),
}));
vi.mock("@/lib/workspace/invitations", () => ({
  resendInvitation: (deps: unknown, input: unknown) =>
    resendInvitation(deps, input),
}));
vi.mock("@/lib/notify/workspace", () => ({
  sendWorkspaceInviteEmail: vi.fn(),
}));
vi.mock("@/lib/design/notify", () => ({
  appUrl: (p: string) => `https://staging.example.com${p}`,
}));

import {
  EmailConfigError,
  MailSendError,
  MIN_MAIL_ROUTE_MAX_DURATION,
} from "@/lib/email";
import { maxDuration, POST } from "./route";

const OWNER = {
  ctx: {
    dbUser: { id: "u1", firstName: "Ada", lastName: "L" },
    workspace: { id: "w1", name: "Acme" },
    role: "owner",
  },
};

function call() {
  return POST(new Request("http://x", { method: "POST" }), {
    params: Promise.resolve({ id: "inv1" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  guardWorkspaceRoute.mockResolvedValue(OWNER);
  requireVerifiedEmail.mockReturnValue(undefined);
  checkRateLimit.mockResolvedValue({ ok: true });
  can.mockReturnValue(true);
  resendInvitation.mockResolvedValue({ ok: true });
});

describe("POST /api/workspace/invitations/[id]/resend", () => {
  it("allows longer than the platform default so a stalled send is reportable", () => {
    expect(maxDuration).toBeGreaterThanOrEqual(MIN_MAIL_ROUTE_MAX_DURATION);
  });

  it("resends", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("refuses before touching SMTP when the inviter is unverified", async () => {
    requireVerifiedEmail.mockReturnValue(
      Response.json({ error: "Verify" }, { status: 403 }),
    );
    expect((await call()).status).toBe(403);
    expect(resendInvitation).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    checkRateLimit.mockResolvedValue({ ok: false });
    expect((await call()).status).toBe(429);
  });

  it("404s an invitation that is not there", async () => {
    resendInvitation.mockResolvedValue({ ok: false });
    expect((await call()).status).toBe(404);
  });

  /* A brand manager holds invite_contributor but not manage_team, so they may
     only act on invitations they sent themselves. */
  it("blocks a limited role from resending someone else's invitation", async () => {
    can.mockReturnValue(false);
    getInvitationById.mockResolvedValue({
      workspaceId: "w1",
      invitedById: "SOMEONE_ELSE",
    });
    expect((await call()).status).toBe(404);
    expect(resendInvitation).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing configuration", new EmailConfigError(["ZOHO_SMTP_USER"])],
    [
      "a relay rejection",
      new MailSendError(
        Object.assign(new Error("relay"), {
          responseCode: 553,
          response: "553 Relaying disallowed as hello@kocontentstudios.com",
        }),
      ),
    ],
  ])("reports %s without leaking internals", async (_case, err) => {
    resendInvitation.mockRejectedValue(err);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call();
    expect(res.status).toBe(500);
    const { error } = (await res.json()) as { error: string };
    expect(error).not.toMatch(/ZOHO|SMTP|redeploy|2FA/i);
    expect(error).not.toContain("hello@kocontentstudios.com");
  });

  /* postgres.js rejects with ECONNREFUSED too; only a tagged failure may be
     described as an email problem. */
  it("does not blame email for a database failure", async () => {
    resendInvitation.mockRejectedValue(
      Object.assign(new Error("write CONNECT"), { code: "ECONNREFUSED" }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { error } = (await (await call()).json()) as { error: string };
    expect(error).toBe("Could not resend the invitation. Please try again.");
  });

  /* Resending is exactly what fails again for these, so the message must not
     invite it — unlike a timeout, which is worth another go. */
  it.each([
    ["a rejected recipient", 550, "RCPT TO"],
    ["a refused sender", 553, "MAIL FROM"],
  ])(
    "does not suggest retrying after %s",
    async (_case, responseCode, command) => {
      resendInvitation.mockRejectedValue(
        new MailSendError(
          Object.assign(new Error("x"), { responseCode, command }),
        ),
      );
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { error } = (await (await call()).json()) as { error: string };
      expect(error).not.toContain("try again");
    },
  );

  it("does suggest retrying a transient failure", async () => {
    resendInvitation.mockRejectedValue(
      new MailSendError(Object.assign(new Error("t"), { code: "ETIMEDOUT" })),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { error } = (await (await call()).json()) as { error: string };
    expect(error).toContain("try again");
  });

  it("warns the owner when the re-emitted link host is provably wrong", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.koc.com");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.koc.com");
    vi.stubEnv("VERCEL_BRANCH_URL", "koos-git-staging.vercel.app");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = (await (await call()).json()) as { warning?: string };
    expect(body.warning).toContain("will not work");
  });

  it("keeps the SMTP diagnostics in the log", async () => {
    resendInvitation.mockRejectedValue(
      new MailSendError(
        Object.assign(new Error("Invalid login"), {
          code: "EAUTH",
          responseCode: 535,
        }),
      ),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await call();
    expect(error.mock.calls[0].join(" ")).toContain("responseCode=535");
  });
});
