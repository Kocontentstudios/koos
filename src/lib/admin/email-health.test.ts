import { describe, expect, it } from "vitest";
import { emailHealthReport, maskAddress } from "@/lib/admin/email-health";
import type { MailEnv } from "@/lib/email";

const WORKING: MailEnv = {
  ZOHO_SMTP_USER: "admin@kocontentstudios.com",
  ZOHO_SMTP_PASS: "app-password",
  ZOHO_MAIL_FROM: "admin@kocontentstudios.com",
  NEXT_PUBLIC_APP_URL: "https://app.kocontentstudios.com",
  VERCEL_ENV: "production",
  VERCEL_PROJECT_PRODUCTION_URL: "app.kocontentstudios.com",
};

describe("maskAddress", () => {
  it("keeps the domain and the first character", () => {
    expect(maskAddress("admin@kocontentstudios.com")).toBe(
      "a****@kocontentstudios.com",
    );
  });

  it("returns null for a blank value", () => {
    expect(maskAddress("   ")).toBeNull();
    expect(maskAddress(undefined)).toBeNull();
  });

  /* Slicing by UTF-16 index would emit half a surrogate pair. */
  it("does not split an astral character", () => {
    const masked = maskAddress("\u{1F600}xx@b.com") as string;
    expect(masked).toBe("\u{1F600}**@b.com");
    expect(JSON.parse(JSON.stringify(masked))).toBe(masked);
  });

  it("does not decorate a single-character local part", () => {
    expect(maskAddress("a@b.com")).toBe("*@b.com");
  });
});

describe("emailHealthReport", () => {
  it("reports a healthy production environment with no warnings", () => {
    const report = emailHealthReport(WORKING);
    expect(report.configured).toBe(true);
    expect(report.fromMatchesUser).toBe(true);
    expect(report.warnings).toEqual([]);
    expect(report.inviteLinkBase).toBe("https://app.kocontentstudios.com");
  });

  it("never includes a credential value", () => {
    const serialized = JSON.stringify(emailHealthReport(WORKING));
    expect(serialized).not.toContain("app-password");
    expect(serialized).not.toContain("admin@kocontentstudios.com");
  });

  it("names the missing variables when SMTP is unconfigured", () => {
    const report = emailHealthReport({ NEXT_PUBLIC_APP_URL: "https://x.com" });
    expect(report.configured).toBe(false);
    expect(report.missing).toEqual(["ZOHO_SMTP_USER", "ZOHO_SMTP_PASS"]);
    expect(report.warnings[0]).toContain("ZOHO_SMTP_USER");
  });

  /* Only Zoho knows whether the From address is a registered alias, and
     .env.example explicitly sanctions using one. Warning about it would leave
     a correct configuration permanently amber, so it is a note. */
  it("notes the alias rather than warning about it", () => {
    const report = emailHealthReport({
      ...WORKING,
      ZOHO_MAIL_FROM: "hello@kocontentstudios.com",
    });
    expect(report.fromMatchesUser).toBe(false);
    expect(report.warnings).toEqual([]);
    expect(report.notes.join(" ")).toContain("553");
  });

  /* The panel used to render "Mailbox: not set / Sends as: not set" while
     still claiming configured, because presence and usability disagreed. */
  it("does not call whitespace-only credentials configured", () => {
    const report = emailHealthReport({
      ...WORKING,
      ZOHO_SMTP_USER: "   ",
      ZOHO_MAIL_FROM: "   ",
    });
    expect(report.configured).toBe(false);
    expect(report.warnings[0]).toContain("ZOHO_SMTP_USER");
  });

  /* "staging-app.koc.com" CONTAINS "app.koc.com" and is a correct staging
     host — a substring test called it a production leak. */
  it("does not mistake a staging host that contains the production host", () => {
    const report = emailHealthReport({
      ...WORKING,
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_APP_URL: "https://staging-app.kocontentstudios.com",
      VERCEL_BRANCH_URL: "staging-app.kocontentstudios.com",
    });
    expect(report.inviteLinkBase).toBe(
      "https://staging-app.kocontentstudios.com",
    );
    expect(report.warnings).toEqual([]);
    expect(report.notes).toEqual([]);
  });

  /* A custom staging domain cannot be verified from the environment — Vercel
     does not expose deployment aliases — so it is a note, not a warning. */
  /* Staging runs on its own branch DOMAIN, which can never appear in
     deploymentHosts() (only *.vercel.app does). Warning here would fire
     permanently on the correct configuration and train the operator to ignore
     the one alarm that matters — so it is a note, which still stops the panel
     claiming delivery. */
  it("notes a host it cannot confirm rather than calling it broken", () => {
    const report = emailHealthReport({
      ...WORKING,
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_APP_URL: "https://staging.kocontentstudios.com",
      VERCEL_BRANCH_URL: "koos-git-staging.vercel.app",
    });
    expect(report.warnings).toEqual([]);
    expect(report.notes.join(" ")).toContain("staging.kocontentstudios.com");
  });

  /* The provable case keeps warning: resolving to the production host from a
     non-production deployment is exactly what a project-wide
     NEXT_PUBLIC_APP_URL bakes into a staging build. */
  it("still warns when the resolved host IS the production host", () => {
    const report = emailHealthReport({
      ...WORKING,
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: "koos-git-staging.vercel.app",
    });
    expect(report.warnings.join(" ")).toContain("production host");
  });

  it.each(["", "   "])("flags a blank ZOHO_SMTP_HOST (%j)", (value) => {
    const report = emailHealthReport({ ...WORKING, ZOHO_SMTP_HOST: value });
    expect(report.host).toBe("smtp.zoho.com");
  });

  it.each([
    "app.kocontentstudios.com",
    "https://app.kocontentstudios.com?x=1",
    "https://app.kocontentstudios.com/sub",
  ])("flags %j as an unusable NEXT_PUBLIC_APP_URL", (value) => {
    const report = emailHealthReport({
      ...WORKING,
      VERCEL_ENV: "production",
      NEXT_PUBLIC_APP_URL: value,
    });
    expect(report.warnings.join(" ")).toContain("absolute http(s) origin");
  });

  it("flags a blank ZOHO_MAIL_FROM", () => {
    const report = emailHealthReport({ ...WORKING, ZOHO_MAIL_FROM: "" });
    expect(report.warnings.join(" ")).toContain("blank");
  });

  /* The exact shape of BUG-008's second failure: a project-wide
     NEXT_PUBLIC_APP_URL baked the production URL into the staging build. */
  it("flags staging invite links that resolve to the production host", () => {
    const report = emailHealthReport({
      ...WORKING,
      VERCEL_ENV: "preview",
      VERCEL_BRANCH_URL: "koos-git-staging.vercel.app",
    });
    expect(report.warnings.join(" ")).toContain("production host");
  });

  it("stays quiet when the staging deployment resolves to its own host", () => {
    const report = emailHealthReport({
      ...WORKING,
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_APP_URL: "https://koos-git-staging.vercel.app",
      VERCEL_BRANCH_URL: "koos-git-staging.vercel.app",
    });
    expect(report.inviteLinkBase).toBe("https://koos-git-staging.vercel.app");
    expect(report.warnings).toEqual([]);
    expect(report.notes).toEqual([]);
  });

  it("says the host cannot be checked when Vercel vars are absent", () => {
    const report = emailHealthReport({
      ZOHO_SMTP_USER: "a@b.com",
      ZOHO_SMTP_PASS: "p",
      ZOHO_MAIL_FROM: "a@b.com",
      NEXT_PUBLIC_APP_URL: "https://app.koc.com",
      NODE_ENV: "production",
    });
    expect(report.warnings).toEqual([]);
    expect(report.notes.join(" ")).toContain("cannot be checked");
  });

  /* Decidable from two variables, so it is caught before a send rather than
     diagnosed from an ESOCKET that reads as an unreachable network. */
  it.each([
    ["587", "true"],
    ["465", "false"],
  ])("flags port %s paired with secure=%s", (port, secure) => {
    const report = emailHealthReport({
      ...WORKING,
      ZOHO_SMTP_PORT: port,
      ZOHO_SMTP_SECURE: secure,
    });
    expect(report.warnings.join(" ")).toContain("ZOHO_SMTP_SECURE");
  });

  it.each([
    ["587", "false"],
    ["465", "true"],
  ])("stays quiet for the correct pairing %s / %s", (port, secure) => {
    const report = emailHealthReport({
      ...WORKING,
      ZOHO_SMTP_PORT: port,
      ZOHO_SMTP_SECURE: secure,
    });
    expect(report.warnings).toEqual([]);
  });

  it("reports secure=false on the STARTTLS port", () => {
    const report = emailHealthReport({ ...WORKING, ZOHO_SMTP_PORT: "587" });
    expect(report.port).toBe(587);
    expect(report.secure).toBe(false);
  });

  it("flags localhost invite links on a deployed environment", () => {
    const report = emailHealthReport({
      ZOHO_SMTP_USER: "a@b.com",
      ZOHO_SMTP_PASS: "p",
      ZOHO_MAIL_FROM: "a@b.com",
      VERCEL_ENV: "preview",
    });
    expect(report.warnings.join(" ")).toContain("localhost");
  });
});
