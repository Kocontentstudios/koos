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

export const STATUS_LABELS = {
  submitted: "Submitted",
  assigned: "Assigned",
  in_progress: "In progress",
  ready_for_review: "Ready for review",
  delivered: "Delivered",
  revision_requested: "Revision requested",
} as const;

type StatusKey = keyof typeof STATUS_LABELS;

function statusLabel(status: string): string {
  return STATUS_LABELS[status as StatusKey] ?? status;
}

export interface TicketStatusEmailInput {
  ticketNumber: number;
  designType: string;
  status: string;
  ticketUrl: string;
}

export function ticketStatusEmail(i: TicketStatusEmailInput): BuiltEmail {
  const label = statusLabel(i.status);
  const html = shell(
    `Update on your design request — ${formatTicketNumber(i.ticketNumber)}`,
    `<p style="font-size:13px">Your <strong>${escapeHtml(
      i.designType,
    )}</strong> request is now: <strong>${escapeHtml(label)}</strong>.</p>
    <p style="margin-top:16px"><a href="${i.ticketUrl}" style="color:#138bc8">View your request →</a></p>`,
  );
  return {
    subject: `${label} — ${formatTicketNumber(i.ticketNumber)}`,
    html,
  };
}

export interface TicketProgressEmailInput {
  ticketNumber: number;
  designType: string;
  message: string;
  status: string | null;
  ticketUrl: string;
}

export function ticketProgressEmail(i: TicketProgressEmailInput): BuiltEmail {
  const statusRow = i.status
    ? row("New status", escapeHtml(statusLabel(i.status)))
    : "";
  const html = shell(
    `Progress update — ${formatTicketNumber(i.ticketNumber)}`,
    `<p style="font-size:13px">New update on your <strong>${escapeHtml(
      i.designType,
    )}</strong> request:</p>
    <blockquote style="margin:8px 0;padding:8px 12px;border-left:3px solid #138bc8;font-size:13px">${escapeHtml(
      i.message,
    )}</blockquote>
    <table style="border-collapse:collapse;width:100%">${statusRow}</table>
    <p style="margin-top:16px"><a href="${i.ticketUrl}" style="color:#138bc8">View your request →</a></p>`,
  );
  return {
    subject: `Progress update — ${formatTicketNumber(i.ticketNumber)}`,
    html,
  };
}

export interface TicketReviewTeamEmailInput {
  ticketNumber: number;
  designType: string;
  action: "approve" | "revise";
  note: string | null;
  requesterName: string;
  requesterEmail: string;
  adminUrl: string;
}

export function ticketReviewTeamEmail(
  i: TicketReviewTeamEmailInput,
): BuiltEmail {
  const verb = i.action === "approve" ? "approved" : "requested a revision on";
  const noteRow = i.note ? row("Revision note", escapeHtml(i.note)) : "";
  const html = shell(
    `Customer ${verb} ${formatTicketNumber(i.ticketNumber)}`,
    `<p style="font-size:13px"><strong>${escapeHtml(
      i.requesterName,
    )}</strong> &lt;${escapeHtml(i.requesterEmail)}&gt; ${verb} the <strong>${escapeHtml(
      i.designType,
    )}</strong> delivery.</p>
    <table style="border-collapse:collapse;width:100%">${noteRow}</table>
    <p style="margin-top:16px"><a href="${i.adminUrl}" style="color:#138bc8">Open the ticket →</a></p>`,
  );
  const subjectVerb =
    i.action === "approve" ? "Design approved" : "Revision requested";
  return {
    subject: `${subjectVerb} — ${formatTicketNumber(i.ticketNumber)}`,
    html,
  };
}

export interface RoleChangeEmailInput {
  firstName: string;
  newRole: string;
  dashboardUrl: string;
}

export function roleChangeEmail(i: RoleChangeEmailInput): BuiltEmail {
  const html = shell(
    "Your KO OS role has changed",
    `<p style="font-size:13px">Hi ${escapeHtml(
      i.firstName,
    )}, your account role is now <strong>${escapeHtml(
      i.newRole,
    )}</strong>. Your access updates the next time you sign in or refresh.</p>
    <p style="margin-top:16px"><a href="${i.dashboardUrl}" style="color:#138bc8">Open KO OS →</a></p>`,
  );
  return { subject: "Your KO OS role has changed", html };
}

export interface WelcomeEmailInput {
  firstName: string;
  dashboardUrl: string;
}

export function welcomeEmail(i: WelcomeEmailInput): BuiltEmail {
  const html = shell(
    "Welcome to KO OS",
    `<p style="font-size:13px">Hi ${escapeHtml(
      i.firstName,
    )}, your account is ready. Set up your brand and generate your first content strategy in minutes.</p>
    <p style="margin-top:16px"><a href="${i.dashboardUrl}" style="color:#138bc8">Go to your dashboard →</a></p>`,
  );
  return { subject: "Welcome to KO OS", html };
}

export interface ContactFormEmailInput {
  name: string;
  email: string;
  message: string;
}

export function contactFormEmail(i: ContactFormEmailInput): BuiltEmail {
  const html = shell(
    "New contact form message",
    `<table style="border-collapse:collapse;width:100%">
    ${row("From", `${escapeHtml(i.name)} &lt;${escapeHtml(i.email)}&gt;`)}
    </table>
    <p style="font-size:13px;white-space:pre-wrap">${escapeHtml(i.message)}</p>`,
  );
  return { subject: `Contact form — ${i.name}`, html };
}

export interface PasswordResetEmailInput {
  firstName: string;
  resetUrl: string;
}

export function passwordResetEmail(i: PasswordResetEmailInput): BuiltEmail {
  const html = shell(
    "Reset your KO OS password",
    `<p style="font-size:13px">Hi ${escapeHtml(
      i.firstName,
    )}, we received a request to reset your password. This link is valid for 1 hour and can be used once:</p>
    <p style="margin-top:16px"><a href="${i.resetUrl}" style="color:#138bc8">Reset your password →</a></p>
    <p style="font-size:12px;color:#6b7280;margin-top:16px">If you didn't request this, you can safely ignore this email — your password is unchanged.</p>`,
  );
  return { subject: "Reset your KO OS password", html };
}
