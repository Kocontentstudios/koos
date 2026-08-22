import { describe, expect, it } from "vitest";
import {
  contactFormEmail,
  type DesignDeliveryEmailInput,
  type DesignRequestEmailInput,
  designDeliveryEmail,
  designRequestConfirmationEmail,
  designRequestTeamEmail,
  memberJoinedEmail,
  passwordResetEmail,
  roleChangeEmail,
  STATUS_LABELS,
  ticketProgressEmail,
  ticketReviewClientEmail,
  ticketReviewTeamEmail,
  ticketStatusEmail,
  welcomeEmail,
  workspaceInviteEmail,
} from "./email-templates";

const REQ: DesignRequestEmailInput = {
  ticketNumber: 124,
  requesterName: "Ada Lovelace",
  requesterEmail: "ada@example.com",
  deliveryEmail: "studio@client.com",
  brandName: "Acme Co",
  designType: "Instagram Carousel (1080x1350 per slide)",
  dimensions: "1080x1350",
  slides: 6,
  brief: "Six-slide launch teaser",
  notes: "Use the <blue> brand palette",
  dueDate: new Date("2026-07-10T00:00:00Z"),
  adminUrl: "https://app.test/admin/tickets",
  ticketUrl: "https://app.test/design-request/abc",
};

describe("designRequestTeamEmail", () => {
  const { subject, html } = designRequestTeamEmail(REQ);
  it("subject carries the formatted ticket number", () => {
    expect(subject).toContain("DT-00124");
  });
  it("body includes every field the team needs to act", () => {
    for (const needle of [
      "DT-00124",
      "Ada Lovelace",
      "ada@example.com",
      "studio@client.com",
      "Acme Co",
      "Instagram Carousel",
      "1080x1350",
      "6",
      "Six-slide launch teaser",
      "July 10, 2026",
      "https://app.test/admin/tickets",
    ]) {
      expect(html).toContain(needle);
    }
  });
  it("escapes HTML in free-text fields", () => {
    expect(html).toContain("&lt;blue&gt;");
    expect(html).not.toContain("<blue>");
  });
});

describe("designRequestConfirmationEmail", () => {
  it("summarizes the request and links to the requester's ticket", () => {
    const { subject, html } = designRequestConfirmationEmail(REQ);
    expect(subject).toContain("DT-00124");
    expect(html).toContain("Six-slide launch teaser");
    expect(html).toContain("https://app.test/design-request/abc");
  });
});

describe("designDeliveryEmail", () => {
  const input: DesignDeliveryEmailInput = {
    ticketNumber: 124,
    designType: "Instagram Carousel (1080x1350 per slide)",
    links: [
      { fileName: "slide-1.png", url: "https://r2.test/a?sig=1" },
      { fileName: "slide-2.png", url: "https://r2.test/b?sig=2" },
    ],
    version: 1,
    ticketUrl: "https://app.test/design-request/abc",
  };
  it("lists every deliverable as a download link", () => {
    const { subject, html } = designDeliveryEmail(input);
    expect(subject).toContain("DT-00124");
    expect(html).toContain("slide-1.png");
    expect(html).toContain("https://r2.test/a?sig=1");
    expect(html).toContain("slide-2.png");
    expect(html).toContain("https://r2.test/b?sig=2");
  });

  it("announces a first delivery without version noise", () => {
    const { subject } = designDeliveryEmail(input);
    expect(subject).toContain("Your design is ready");
    expect(subject).not.toContain("v1");
  });

  it("frames a later round as the revision the client asked for", () => {
    const { subject, html } = designDeliveryEmail({ ...input, version: 3 });
    expect(subject).toContain("Revision v3 is ready");
    expect(html).toContain("v3");
  });
});

describe("ticketReviewClientEmail", () => {
  const base = {
    ticketNumber: 124,
    designType: "Flyer",
    version: 2,
    ticketUrl: "https://app.test/design-request/abc",
  };

  it("confirms an approval and says the request is closed", () => {
    const { subject, html } = ticketReviewClientEmail({
      ...base,
      action: "approve",
      note: null,
    });
    expect(subject).toContain("Design approved");
    expect(html).toContain("closed");
    expect(html).toContain("v2");
  });

  it("echoes the revision note back to the client", () => {
    const { subject, html } = ticketReviewClientEmail({
      ...base,
      action: "revise",
      note: "Make the logo bigger",
    });
    expect(subject).toContain("Revision requested");
    expect(html).toContain("Make the logo bigger");
  });

  it("escapes html in the note", () => {
    const { html } = ticketReviewClientEmail({
      ...base,
      action: "revise",
      note: "<script>alert(1)</script>",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("ticketStatusEmail", () => {
  it("uses the human status label and escapes the design type", () => {
    const { subject, html } = ticketStatusEmail({
      ticketNumber: 42,
      designType: "<b>Flyer</b>",
      status: "ready_for_review",
      ticketUrl: "https://app/design-request/42",
    });
    expect(subject).toContain("Delivered — your review");
    expect(html).toContain("Delivered — your review");
    expect(html).toContain("&lt;b&gt;Flyer&lt;/b&gt;");
    expect(html).toContain("https://app/design-request/42");
    expect(html).not.toContain("ready_for_review");
  });
});

describe("ticketProgressEmail", () => {
  it("includes the escaped message and optional status", () => {
    const { html } = ticketProgressEmail({
      ticketNumber: 7,
      designType: "Logo",
      message: "First draft <ready>",
      status: "in_progress",
      ticketUrl: "https://app/t/7",
    });
    expect(html).toContain("First draft &lt;ready&gt;");
    expect(html).toContain(STATUS_LABELS.in_progress);
  });

  it("omits the status row when status is null", () => {
    const { html } = ticketProgressEmail({
      ticketNumber: 7,
      designType: "Logo",
      message: "Note",
      status: null,
      ticketUrl: "https://app/t/7",
    });
    expect(html).not.toContain("New status");
  });
});

describe("ticketReviewTeamEmail", () => {
  it("says approved with no note row", () => {
    const { subject, html } = ticketReviewTeamEmail({
      ticketNumber: 3,
      designType: "Banner",
      action: "approve",
      note: null,
      requesterName: "Ada",
      requesterEmail: "ada@x.com",
      adminUrl: "https://app/admin/tickets/3",
    });
    expect(subject.toLowerCase()).toContain("approved");
    expect(html).toContain("Ada");
    expect(html).not.toContain("Revision note");
  });

  it("says revision requested and escapes the note", () => {
    const { subject, html } = ticketReviewTeamEmail({
      ticketNumber: 3,
      designType: "Banner",
      action: "revise",
      note: "Make it <pop>",
      requesterName: "Ada",
      requesterEmail: "ada@x.com",
      adminUrl: "https://app/admin/tickets/3",
    });
    expect(subject.toLowerCase()).toContain("revision");
    expect(html).toContain("Make it &lt;pop&gt;");
  });
});

describe("roleChangeEmail", () => {
  it("names the new role and greets by first name", () => {
    const { html } = roleChangeEmail({
      firstName: "Sam",
      newRole: "designer",
      dashboardUrl: "https://app/dashboard",
    });
    expect(html).toContain("Sam");
    expect(html).toContain("designer");
  });
});

describe("welcomeEmail", () => {
  it("greets by first name and links the dashboard", () => {
    const { subject, html } = welcomeEmail({
      firstName: "Sam",
      dashboardUrl: "https://app/dashboard",
    });
    expect(subject).toContain("Welcome");
    expect(html).toContain("Sam");
    expect(html).toContain("https://app/dashboard");
  });
});

describe("contactFormEmail", () => {
  it("carries sender identity and escapes the message", () => {
    const { subject, html } = contactFormEmail({
      name: "Eve <script>",
      email: "eve@x.com",
      message: "Hi <there>",
    });
    expect(subject).toContain("Contact form");
    expect(html).toContain("Eve &lt;script&gt;");
    expect(html).toContain("eve@x.com");
    expect(html).toContain("Hi &lt;there&gt;");
  });
});

describe("passwordResetEmail", () => {
  it("links the reset URL and warns about expiry", () => {
    const { subject, html } = passwordResetEmail({
      firstName: "Sam",
      resetUrl: "https://app/reset-password?token=abc",
    });
    expect(subject).toContain("Reset");
    expect(html).toContain("https://app/reset-password?token=abc");
    expect(html).toContain("Sam");
    expect(html.toLowerCase()).toContain("hour");
  });
});

describe("workspaceInviteEmail", () => {
  const built = workspaceInviteEmail({
    inviterName: "Seyi <Owner>",
    workspaceName: "KO Content Studio",
    acceptUrl: "https://app/invite/RAWTOKEN",
    roleLabel: "Brand Manager",
    expiresInDays: 7,
  });

  it("names the role the invitee will hold", () => {
    expect(built.html).toContain("Brand Manager");
  });

  it("subject names the inviter and workspace", () => {
    expect(built.subject).toBe(
      "Seyi <Owner> invited you to join KO Content Studio on KO OS",
    );
  });

  it("html carries the accept link, expiry note, and escapes names", () => {
    expect(built.html).toContain("https://app/invite/RAWTOKEN");
    expect(built.html).toContain("7 days");
    expect(built.html).toContain("Seyi &lt;Owner&gt;");
    expect(built.html).not.toContain("Seyi <Owner>");
  });
});

describe("memberJoinedEmail", () => {
  const built = memberJoinedEmail({
    memberName: "Ada Obi",
    memberEmail: "ada@x.com",
    workspaceName: "KO Content Studio",
    teamUrl: "https://app/team",
  });

  it("tells the owner who joined and links the Team page", () => {
    expect(built.subject).toBe("Ada Obi joined KO Content Studio");
    expect(built.html).toContain("ada@x.com");
    expect(built.html).toContain("https://app/team");
  });
});
