import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { getAnalyticsSessionId } from "@/lib/analytics/session-id";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  checkBrandAccess,
  deleteDraftTicket,
  getDesignTicketById,
  getStaffUsers,
  postClientTicketComment,
  replaceTicketAttachments,
  updateDraftTicket,
} from "@/lib/db/queries";
import {
  attachmentKeyBelongsToUser,
  designRequestSchema,
  draftRequestSchema,
} from "@/lib/design/request-form";
import { formatTicketNumber } from "@/lib/design/ticket";
import {
  attachmentInputsToRows,
  submissionSideEffects,
} from "@/lib/design/ticket-create";

/** Same ceiling the review note uses, so a comment and a revision note are
 *  bounded identically. */
const MAX_COMMENT_LENGTH = 2000;

/** Loads the ticket only when it is the caller's own draft. Non-drafts and
 * other users' tickets 404 identically so existence is never leaked. */
async function getOwnDraft(id: string, userId: string) {
  const ticket = await getDesignTicketById(id);
  if (!ticket || ticket.userId !== userId || ticket.status !== "draft") {
    return null;
  }
  return ticket;
}

/**
 * A comment from the brand side on any ticket they can reach.
 *
 * The client previously had no write path into the timeline outside a formal
 * review, which requires status === "ready_for_review" — so they could say
 * nothing while work was in progress and nothing after approving.
 *
 * This deliberately cannot move the ticket's status. `revision_requested` is
 * reachable only through the review endpoint, and the staff routes cap
 * themselves to the same end; accepting a status here would undo that.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { id } = await params;
  const ticket = await getDesignTicketById(id);
  if (!ticket) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }

  const access = await checkBrandAccess(
    dbUser.id,
    ticket.brandId,
    "manage_content",
  );
  if (!access.ok) {
    return Response.json(
      { error: access.status === 403 ? access.error : "Ticket not found" },
      { status: access.status },
    );
  }

  let body: { message?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return Response.json({ error: "Write a comment first." }, { status: 400 });
  }
  if (message.length > MAX_COMMENT_LENGTH) {
    return Response.json(
      { error: `Keep your comment under ${MAX_COMMENT_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const staff = await getStaffUsers();
  const update = await postClientTicketComment({
    ticketId: id,
    authorId: dbUser.id,
    message,
    staffIds: staff.map((s) => s.id),
    notificationPayload: {
      ticketId: id,
      ticketNumber: ticket.ticketNumber,
      message: `New comment on design ticket ${formatTicketNumber(ticket.ticketNumber)}.`,
    },
  });

  return Response.json({ update }, { status: 201 });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { id } = await params;
  const draft = await getOwnDraft(id, dbUser.id);
  if (!draft) {
    return Response.json({ error: "Draft not found" }, { status: 404 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const submit = (json as { submit?: boolean }).submit === true;
  const parsed = submit
    ? designRequestSchema.safeParse(json)
    : draftRequestSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join(".");
    return Response.json(
      { error: where ? `${where}: ${first.message}` : "Invalid request" },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const brandId = body.brandId ?? draft.brandId;
  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  for (const attachment of body.attachments ?? []) {
    if (
      attachment.kind === "file" &&
      !attachmentKeyBelongsToUser(attachment.key, dbUser.id)
    ) {
      return Response.json({ error: "Invalid attachment" }, { status: 403 });
    }
  }

  try {
    const updated = await updateDraftTicket(id, {
      brandId,
      title: body.title ?? null,
      designType: body.requestType ?? draft.designType,
      brief: body.brief ?? draft.brief,
      priority: body.priority ?? draft.priority,
      specs: body.specs ?? null,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      status: submit ? "submitted" : "draft",
    });
    if (!updated) {
      return Response.json({ error: "Draft not found" }, { status: 404 });
    }
    if (body.attachments) {
      await replaceTicketAttachments(
        id,
        attachmentInputsToRows(id, body.attachments),
      );
    }

    if (submit) {
      await submissionSideEffects(
        updated,
        { userId: dbUser.id, brandId, designType: updated.designType },
        {
          brandName: access.brand.name,
          requesterName: `${dbUser.firstName} ${dbUser.lastName}`.trim(),
          requesterEmail: dbUser.email,
        },
      );
    }
    await captureServerEvent({
      distinctId: dbUser.id,
      event: submit ? "design_ticket_submitted" : "design_ticket_draft_saved",
      properties: {
        brand_id: brandId,
        design_type: updated.designType,
        from_draft: true,
        session_id: await getAnalyticsSessionId(),
      },
    });
    return Response.json({ ticket: updated });
  } catch (err) {
    console.error("update draft ticket failed", err);
    return Response.json(
      { error: "Could not save your draft. Please try again." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { id } = await params;
  const draft = await getOwnDraft(id, dbUser.id);
  if (!draft) {
    return Response.json({ error: "Draft not found" }, { status: 404 });
  }
  /* Own-draft ownership is not enough on its own: a member removed from the
     workspace, or narrowed out of this brand, still owns rows they may no
     longer touch. The capability model decides, as everywhere else. */
  const access = await checkBrandAccess(
    dbUser.id,
    draft.brandId,
    "manage_content",
  );
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }
  await deleteDraftTicket(id);
  return Response.json({ ok: true });
}
