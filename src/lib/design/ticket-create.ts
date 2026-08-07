import {
  addTicketAttachments as dbAddTicketAttachments,
  createDesignTicket as dbCreateDesignTicket,
  recordUsageEvent as dbRecordUsageEvent,
  updateDesignBrief as dbUpdateDesignBrief,
} from "@/lib/db/queries";
import { appUrl, sendDesignRequestEmails } from "@/lib/design/notify";
import type {
  AttachmentInput,
  DesignTicketSpecs,
} from "@/lib/design/request-form";

export interface CreateTicketFromRequestInput {
  brandId: string;
  userId: string;
  designType: string;
  brief: string;
  title?: string | null;
  priority?: "low" | "normal" | "high" | "urgent";
  specs?: DesignTicketSpecs | null;
  attachments?: AttachmentInput[];
  /** Draft tickets are private work-in-progress: no emails, no usage events. */
  saveAsDraft?: boolean;
  dimensions?: string | null;
  slides?: number | null;
  notes?: string | null;
  deliveryEmail?: string | null;
  dueDate?: Date | null;
  calendarItemId?: string | null;
  briefId?: string | null;
  /** Generated design or upload the designer works from. */
  referenceImageUrl?: string | null;
}

export interface CreateTicketFromRequestDeps {
  createDesignTicket?: typeof dbCreateDesignTicket;
  recordUsageEvent?: typeof dbRecordUsageEvent;
  sendEmails?: typeof sendDesignRequestEmails;
  updateDesignBrief?: typeof dbUpdateDesignBrief;
  addAttachments?: typeof dbAddTicketAttachments;
  /** Request context the helper can't derive on its own. */
  brandName: string;
  requesterName: string;
  requesterEmail: string;
}

export function attachmentInputsToRows(
  ticketId: string,
  attachments: AttachmentInput[],
) {
  return attachments.map((a) =>
    a.kind === "file"
      ? {
          ticketId,
          kind: "file" as const,
          category: a.category,
          fileKey: a.key,
          fileName: a.fileName,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          note: a.note ?? null,
        }
      : {
          ticketId,
          kind: "link" as const,
          category: a.category,
          url: a.url,
          note: a.note ?? null,
        },
  );
}

interface SubmittedTicket {
  id: string;
  ticketNumber: number;
  designType: string;
  brief: string;
  dimensions: string | null;
  slides: number | null;
  notes: string | null;
  deliveryEmail: string | null;
  dueDate: Date | null;
}

/** Usage metering + notification emails for a real (non-draft) submission.
 * Also fired when a draft is later submitted, so it lives outside creation. */
export async function submissionSideEffects(
  ticket: SubmittedTicket,
  input: Pick<
    CreateTicketFromRequestInput,
    "userId" | "brandId" | "designType"
  >,
  deps: CreateTicketFromRequestDeps,
) {
  const recordUsageEvent = deps.recordUsageEvent ?? dbRecordUsageEvent;
  const sendEmails = deps.sendEmails ?? sendDesignRequestEmails;

  await recordUsageEvent({
    userId: input.userId,
    brandId: input.brandId,
    kind: "design_ticket_created",
    metadata: { designType: input.designType, ticketId: ticket.id },
  });

  try {
    await sendEmails({
      ticketNumber: ticket.ticketNumber,
      requesterName: deps.requesterName,
      requesterEmail: deps.requesterEmail,
      deliveryEmail: ticket.deliveryEmail,
      brandName: deps.brandName,
      designType: ticket.designType,
      dimensions: ticket.dimensions,
      slides: ticket.slides,
      brief: ticket.brief,
      notes: ticket.notes,
      dueDate: ticket.dueDate,
      adminUrl: appUrl("/admin/tickets"),
      ticketUrl: appUrl(`/design-request/${ticket.id}`),
    });
  } catch (err) {
    console.error("design request emails failed", {
      ticketId: ticket.id,
      err,
    });
  }
}

export async function createTicketFromRequest(
  input: CreateTicketFromRequestInput,
  deps: CreateTicketFromRequestDeps,
) {
  const createTicket = deps.createDesignTicket ?? dbCreateDesignTicket;
  const updateDesignBrief = deps.updateDesignBrief ?? dbUpdateDesignBrief;
  const addAttachments = deps.addAttachments ?? dbAddTicketAttachments;

  const ticket = await createTicket({
    brandId: input.brandId,
    userId: input.userId,
    calendarItemId: input.calendarItemId ?? null,
    designType: input.designType,
    title: input.title ?? null,
    priority: input.priority ?? "normal",
    specs: input.specs ?? null,
    dimensions: input.dimensions ?? null,
    slides: input.slides ?? null,
    brief: input.brief,
    notes: input.notes ?? null,
    deliveryEmail: input.deliveryEmail ?? null,
    dueDate: input.dueDate ?? null,
    referenceImageUrl: input.referenceImageUrl ?? null,
    status: input.saveAsDraft ? "draft" : "submitted",
  });

  if (input.attachments?.length) {
    await addAttachments(attachmentInputsToRows(ticket.id, input.attachments));
  }

  if (input.briefId) {
    // Best-effort back-pointer: the ticket is already created, so a
    // failure here must not fail the submission.
    try {
      await updateDesignBrief(input.briefId, { ticketId: ticket.id });
    } catch (err) {
      console.error("linking design brief to ticket failed", {
        briefId: input.briefId,
        ticketId: ticket.id,
        err,
      });
    }
  }

  if (!input.saveAsDraft) {
    await submissionSideEffects(ticket, input, deps);
  }

  return { ticket };
}
