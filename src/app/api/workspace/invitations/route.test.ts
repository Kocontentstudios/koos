import { beforeEach, describe, expect, it, vi } from "vitest";

const guardWorkspaceRoute = vi.fn();
const requireVerifiedEmail = vi.fn();
const checkRateLimit = vi.fn();
const createInvitation = vi.fn();
const getMembership = vi.fn();
const sendWorkspaceInviteEmail = vi.fn();

vi.mock("@/lib/auth/workspace-guard", () => ({
  guardWorkspaceRoute: (perms: string[]) => guardWorkspaceRoute(perms),
}));
vi.mock("@/lib/auth/require-verified-email", () => ({
  requireVerifiedEmail: (user: unknown) => requireVerifiedEmail(user),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (policy: unknown) => checkRateLimit(policy),
  tooManyRequests: () => Response.json({ error: "Slow down" }, { status: 429 }),
}));
vi.mock("@/lib/db/queries", () => ({
  createWorkspaceInvitation: vi.fn(),
  getAssignedBrandIds: vi.fn().mockResolvedValue([]),
  getMembership: (w: string, u: string) => getMembership(w, u),
  getPendingInvitationByEmail: vi.fn(),
  getUserByEmail: vi.fn(),
  getWorkspaceBrandIds: vi.fn(),
}));
vi.mock("@/lib/workspace/invitations", () => ({
  createInvitation: (deps: unknown, input: unknown) =>
    createInvitation(deps, input),
}));
vi.mock("@/lib/notify/workspace", () => ({
  sendWorkspaceInviteEmail: (args: unknown) => sendWorkspaceInviteEmail(args),
}));
vi.mock("@/lib/design/notify", () => ({
  appUrl: (path: string) => `https://staging.example.com${path}`,
}));

import {
  EmailConfigError,
  MailSendError,
  MIN_MAIL_ROUTE_MAX_DURATION,
} from "@/lib/email";
import { maxDuration, POST } from "./route";

const OWNER = {
  ctx: {
    dbUser: { id: "u1", firstName: "Ada", lastName: "L", emailVerified: true },
    workspace: { id: "w1", name: "Acme" },
    role: "owner",
  },
};

function req(body: unknown = { email: "new@x.com", role: "contributor" }) {
  return new Request("http://x/api/workspace/invitations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  guardWorkspaceRoute.mockResolvedValue(OWNER);
  requireVerifiedEmail.mockReturnValue(undefined);
  checkRateLimit.mockResolvedValue({ ok: true });
  getMembership.mockResolvedValue({ brandScope: "all" });
  createInvitation.mockResolvedValue({ ok: true });
});

describe("POST /api/workspace/invitations", () => {
  /* The whole reason BUG-008 was invisible: nodemailer's default timeouts
     outlive the function, so without an explicit budget Vercel kills the
     request before the catch block can log or report anything. */
  it("allows longer than the platform default so an SMTP failure is reportable", () => {
    expect(maxDuration).toBeGreaterThanOrEqual(MIN_MAIL_ROUTE_MAX_DURATION);
  });

  it("refuses before touching SMTP when the inviter is unverified", async () => {
    requireVerifiedEmail.mockReturnValue(
      Response.json({ error: "Verify your email" }, { status: 403 }),
    );
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it("returns 200 on a successful invite", async () => {
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  /* The owner who pressed the button cannot open the admin Email panel, so a
     provably wrong link host has to reach them in this response — reporting
     plain success hands them a link that cannot work. */
  it("warns the owner when the link host is provably wrong", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.koc.com");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.koc.com");
    vi.stubEnv("VERCEL_BRANCH_URL", "koos-git-staging.vercel.app");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = (await (await POST(req())).json()) as { warning?: string };
    expect(body.warning).toContain("will not work");
  });

  /* A custom staging domain looks identical from the environment. Warning the
     owner on every correct send is how the provable case gets ignored. */
  it("stays silent to the owner when the host merely cannot be confirmed", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.koc.com");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.koc.com");
    vi.stubEnv("VERCEL_BRANCH_URL", "koos-git-staging.vercel.app");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = (await (await POST(req())).json()) as { warning?: string };
    expect(body.warning).toBeUndefined();
    // Still recorded for the operator.
    expect(warn).toHaveBeenCalledOnce();
  });

  it("rejects a missing email address", async () => {
    const res = await POST(req({ role: "contributor" }));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown role", async () => {
    const res = await POST(req({ email: "a@b.com", role: "wizard" }));
    expect(res.status).toBe(400);
  });

  /* The recipient of this string is a customer's workspace owner. They cannot
     set an environment variable or redeploy, so our vendor, our env-var names
     and our deploy process must not appear in it — those belong in the log and
     the admin panel. */
  it.each([
    ["a missing configuration", new EmailConfigError(["ZOHO_SMTP_USER"])],
    [
      "a 553 relay rejection",
      new MailSendError(
        Object.assign(new Error("relaying disallowed"), {
          responseCode: 553,
          response: "553 Relaying disallowed as hello@kocontentstudios.com",
        }),
      ),
    ],
    [
      "an unreachable server",
      new MailSendError(Object.assign(new Error("t"), { code: "ETIMEDOUT" })),
    ],
  ])(
    "tells the owner what to do about %s without leaking internals",
    async (_case, err) => {
      createInvitation.mockRejectedValue(err);
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await POST(req());
      expect(res.status).toBe(500);
      const { error } = (await res.json()) as { error: string };
      expect(error).toContain("The invitation was saved");
      expect(error).not.toMatch(/ZOHO|SMTP|redeploy|2FA|env/i);
      expect(error).not.toContain("hello@kocontentstudios.com");
    },
  );

  it("distinguishes an unreachable mail server from a rejected one", async () => {
    createInvitation.mockRejectedValue(
      new MailSendError(
        Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
      ),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req());
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain("could not reach our email service");
  });

  /* The client refreshes on this flag so the Pending tab the error message
     points at is not empty. The client half is pinned in team-client.test;
     without this the server could stop sending it and nothing would notice. */
  it("tells the client the row was saved when only the email failed", async () => {
    createInvitation.mockRejectedValue(
      new MailSendError(Object.assign(new Error("t"), { code: "ETIMEDOUT" })),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const body = (await (await POST(req())).json()) as { saved?: boolean };
    expect(body.saved).toBe(true);
  });

  it("does not claim a row was saved when the database failed", async () => {
    createInvitation.mockRejectedValue(
      Object.assign(new Error("write CONNECT"), { code: "ECONNREFUSED" }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const body = (await (await POST(req())).json()) as { saved?: boolean };
    expect(body.saved).toBe(false);
  });

  /* Resending changes nothing for these: an unconfigured deployment fails
     identically every time, and a rejected address keeps rejecting. */
  it.each([
    ["no SMTP configured", new EmailConfigError(["ZOHO_SMTP_USER"])],
    [
      "a refused sender",
      new MailSendError(
        Object.assign(new Error("relay"), {
          responseCode: 553,
          command: "MAIL FROM",
        }),
      ),
    ],
    [
      "a rejected recipient",
      new MailSendError(
        Object.assign(new Error("no such user"), {
          responseCode: 550,
          command: "RCPT TO",
        }),
      ),
    ],
  ])("does not tell the owner to Resend after %s", async (_case, err) => {
    createInvitation.mockRejectedValue(err);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { error } = (await (await POST(req())).json()) as { error: string };
    expect(error).not.toContain("Resend");
  });

  /* A mistyped invitee address is the far end refusing, not our sender being
     refused — telling the owner to Resend would loop forever. */
  it("blames the address, not the sender, when the recipient is rejected", async () => {
    createInvitation.mockRejectedValue(
      new MailSendError(
        Object.assign(new Error("no such user"), {
          responseCode: 550,
          command: "RCPT TO",
        }),
      ),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { error } = (await (await POST(req())).json()) as { error: string };
    expect(error).toContain("Check it is spelled correctly");
    expect(error).not.toContain("refused to send from this address");
  });

  /* postgres.js rejects with a plain Error carrying ECONNREFUSED when the
     database is unreachable — the same shape an SMTP connection failure has.
     Nothing was written, so the Pending tab is empty and a promise to resend
     would be a lie. */
  it.each([
    new Error("duplicate key value violates unique constraint"),
    Object.assign(new Error("write CONNECT ECONNREFUSED"), {
      code: "ECONNREFUSED",
    }),
    Object.assign(new Error("connection timed out"), { code: "ETIMEDOUT" }),
  ])("does not claim the invitation was saved for %#", async (err) => {
    createInvitation.mockRejectedValue(err);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req());
    const { error } = (await res.json()) as { error: string };
    expect(error).not.toContain("saved");
    expect(error).not.toContain("Resend");
  });

  /* Tagged, which is the only shape production produces — an untagged
     fixture here left the log assertion green while every real failure logged
     nothing but "Sending mail failed". */
  it("logs the SMTP response code for the operator", async () => {
    createInvitation.mockRejectedValue(
      new MailSendError(
        Object.assign(new Error("Invalid login"), {
          code: "EAUTH",
          responseCode: 535,
        }),
      ),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await POST(req());
    expect(error.mock.calls[0].join(" ")).toContain("responseCode=535");
  });
});
