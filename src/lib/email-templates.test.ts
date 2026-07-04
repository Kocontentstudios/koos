import { describe, expect, it } from "vitest";
import {
  type DesignDeliveryEmailInput,
  type DesignRequestEmailInput,
  designDeliveryEmail,
  designRequestConfirmationEmail,
  designRequestTeamEmail,
} from "./email-templates";

const REQ: DesignRequestEmailInput = {
  ticketNumber: 124,
  requesterName: "Ada Lovelace",
  requesterEmail: "ada@example.com",
  deliveryEmail: "studio@client.com",
  brandName: "Acme Co",
  designType: "Instagram Carousel (1080x1080 per slide)",
  dimensions: "1080x1080",
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
      "1080x1080",
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
    designType: "Instagram Carousel (1080x1080 per slide)",
    links: [
      { fileName: "slide-1.png", url: "https://r2.test/a?sig=1" },
      { fileName: "slide-2.png", url: "https://r2.test/b?sig=2" },
    ],
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
});
