import { formatTicketNumber } from "@/lib/design/ticket";

export interface DesignRequestEmailInput {
  ticketNumber: number;
  requesterName: string;
  requesterEmail: string;
  deliveryEmail: string | null;
  brandName: string;
  designType: string;
  dimensions: string | null;
  slides: number | null;
  brief: string;
  notes: string | null;
  dueDate: Date | null;
  adminUrl: string;
  ticketUrl: string;
}

export interface DesignDeliveryEmailInput {
  ticketNumber: number;
  designType: string;
  links: Array<{ fileName: string; url: string }>;
  ticketUrl: string;
}

export interface BuiltEmail {
  subject: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(date: Date | null): string {
  if (!date) return "No due date";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px">${escapeHtml(
    label,
  )}</td><td style="padding:4px 0;font-size:13px">${value}</td></tr>`;
}

function shell(title: string, bodyHtml: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111827">
  <h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(title)}</h2>
  ${bodyHtml}
</div>`;
}

function detailsTable(i: DesignRequestEmailInput): string {
  const dims = i.dimensions ? escapeHtml(i.dimensions) : "—";
  const slides = i.slides != null ? String(i.slides) : "—";
  return `<table style="border-collapse:collapse;width:100%">
    ${row("Ticket", formatTicketNumber(i.ticketNumber))}
    ${row("Brand", escapeHtml(i.brandName))}
    ${row("Design type", escapeHtml(i.designType))}
    ${row("Dimensions", dims)}
    ${row("Slides", slides)}
    ${row("Due by", formatDate(i.dueDate))}
    ${row("Brief", escapeHtml(i.brief))}
    ${row("Notes", i.notes ? escapeHtml(i.notes) : "—")}
  </table>`;
}

export function designRequestTeamEmail(i: DesignRequestEmailInput): BuiltEmail {
  const deliverTo = i.deliveryEmail
    ? escapeHtml(i.deliveryEmail)
    : `${escapeHtml(i.requesterEmail)} (account email)`;
  const html = shell(
    `New design request — ${formatTicketNumber(i.ticketNumber)}`,
    `<p style="font-size:13px">From <strong>${escapeHtml(
      i.requesterName,
    )}</strong> &lt;${escapeHtml(i.requesterEmail)}&gt;</p>
    ${detailsTable(i)}
    <p style="font-size:13px;margin-top:12px">Deliver updates &amp; final design to: <strong>${deliverTo}</strong></p>
    <p style="margin-top:16px"><a href="${i.adminUrl}" style="color:#138bc8">Open the design queue →</a></p>`,
  );
  return {
    subject: `New design request — ${formatTicketNumber(i.ticketNumber)}`,
    html,
  };
}

export function designRequestConfirmationEmail(
  i: DesignRequestEmailInput,
): BuiltEmail {
  const html = shell(
    "We've received your design request",
    `<p style="font-size:13px">Thanks, ${escapeHtml(
      i.requesterName,
    )} — your request is in. We'll send updates and the final design to this address.</p>
    ${detailsTable(i)}
    <p style="margin-top:16px"><a href="${i.ticketUrl}" style="color:#138bc8">Track your request →</a></p>`,
  );
  return {
    subject: `Request received — ${formatTicketNumber(i.ticketNumber)}`,
    html,
  };
}

export function designDeliveryEmail(i: DesignDeliveryEmailInput): BuiltEmail {
  const items = i.links
    .map(
      (l) =>
        `<li style="margin:4px 0"><a href="${l.url}" style="color:#138bc8">${escapeHtml(
          l.fileName,
        )}</a></li>`,
    )
    .join("");
  const html = shell(
    `Your design is ready — ${formatTicketNumber(i.ticketNumber)}`,
    `<p style="font-size:13px">Your ${escapeHtml(
      i.designType,
    )} is ready. Download links are valid for 7 days:</p>
    <ul style="padding-left:18px">${items}</ul>
    <p style="margin-top:16px"><a href="${i.ticketUrl}" style="color:#138bc8">View in your dashboard →</a></p>`,
  );
  return {
    subject: `Your design is ready — ${formatTicketNumber(i.ticketNumber)}`,
    html,
  };
}
