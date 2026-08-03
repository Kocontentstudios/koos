import {
  createDesignTicket as dbCreateDesignTicket,
  recordUsageEvent as dbRecordUsageEvent,
  updateDesignBrief as dbUpdateDesignBrief,
} from "@/lib/db/queries";
import { appUrl, sendDesignRequestEmails } from "@/lib/design/notify";

export interface CreateTicketFromRequestInput {
  brandId: string;
  userId: string;
  designType: string;
  brief: string;
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
  /** Request context the helper can't derive on its own. */
  brandName: string;
  requesterName: string;
  requesterEmail: string;
}

export async function createTicketFromRequest(
  input: CreateTicketFromRequestInput,
  deps: CreateTicketFromRequestDeps,
) {
  const createTicket = deps.createDesignTicket ?? dbCreateDesignTicket;
  const recordUsageEvent = deps.recordUsageEvent ?? dbRecordUsageEvent;
  const sendEmails = deps.sendEmails ?? sendDesignRequestEmails;
  const updateDesignBrief = deps.updateDesignBrief ?? dbUpdateDesignBrief;

  const ticket = await createTicket({
    brandId: input.brandId,
    userId: input.userId,
    calendarItemId: input.calendarItemId ?? null,
    designType: input.designType,
    dimensions: input.dimensions ?? null,
    slides: input.slides ?? null,
    brief: input.brief,
    notes: input.notes ?? null,
    deliveryEmail: input.deliveryEmail ?? null,
    dueDate: input.dueDate ?? null,
    referenceImageUrl: input.referenceImageUrl ?? null,
    status: "submitted",
  });

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

  return { ticket };
}
