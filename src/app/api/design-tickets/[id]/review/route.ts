import { getAuthUser } from "@/lib/auth/get-user";
import {
  type AnnotationShape,
  addAnnotation,
  checkBrandAccess,
  createNotification,
  getDeliverables,
  getDesignTicketById,
  getStaffUsers,
  updateCalendarItemStatus,
  updateDesignTicket,
} from "@/lib/db/queries";
import { appUrl, sendTicketReviewTeamEmail } from "@/lib/design/notify";

type ReviewAnnotationInput = {
  deliverableId: string;
  shapes: unknown;
  note?: string;
};

function isFiniteNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

// A malformed shape (missing coords, odd-length coords, non-numeric coords,
// unknown type) would throw when the admin overlay renders it, so anything
// that doesn't match this shape is dropped before it ever reaches storage.
function isValidAnnotationShape(shape: unknown): shape is AnnotationShape {
  if (typeof shape !== "object" || shape === null) return false;
  const { type, coords, color } = shape as Record<string, unknown>;
  if (type !== "rect" && type !== "path") return false;
  if (!isFiniteNumberArray(coords) || coords.length % 2 !== 0) return false;
  if (type === "rect" && coords.length !== 4) return false;
  if (type === "path" && coords.length < 4) return false;
  return typeof color === "string";
}

function filterValidShapes(shapes: unknown): AnnotationShape[] {
  if (!Array.isArray(shapes)) return [];
  return shapes.filter(isValidAnnotationShape);
}

// Deliverables must belong to the ticket being reviewed, otherwise a caller
// could smuggle an annotation onto another ticket's deliverable.
async function persistReviewAnnotations(
  ticketId: string,
  authorId: string,
  annotations: ReviewAnnotationInput[] | undefined,
) {
  if (!annotations || annotations.length === 0) return;
  try {
    const deliverables = await getDeliverables(ticketId);
    const validDeliverableIds = new Set(deliverables.map((d) => d.id));
    for (const annotation of annotations) {
      if (!validDeliverableIds.has(annotation.deliverableId)) continue;
      const shapes = filterValidShapes(annotation.shapes);
      if (shapes.length === 0) continue;
      await addAnnotation({
        ticketId,
        deliverableId: annotation.deliverableId,
        authorId,
        shapes,
        note: annotation.note,
      });
    }
  } catch (err) {
    console.error("review: annotation persistence failed", { ticketId, err });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { id } = await params;

  let body: {
    action?: "approve" | "revise";
    note?: string;
    annotations?: ReviewAnnotationInput[];
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

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
      { error: "Ticket not found" },
      { status: access.status },
    );
  }

  const u = dbUser;
  async function notifyTeamOfReview(
    action: "approve" | "revise",
    note: string | null,
  ) {
    try {
      await sendTicketReviewTeamEmail({
        ticketNumber: ticket.ticketNumber,
        designType: ticket.designType,
        action,
        note,
        requesterName: `${u.firstName} ${u.lastName}`.trim(),
        requesterEmail: u.email,
        adminUrl: appUrl(`/admin/tickets/${id}`),
      });
    } catch (err) {
      console.error("review: team email failed", { ticketId: id, err });
    }
  }

  if (body.action === "approve") {
    const updated = await updateDesignTicket(id, { status: "delivered" });
    if (ticket.calendarItemId) {
      await updateCalendarItemStatus(ticket.calendarItemId, "ready");
    }
    await notifyTeamOfReview("approve", null);
    return Response.json({ ticket: updated });
  }

  if (body.action === "revise") {
    const note = body.note?.trim();
    const updated = await updateDesignTicket(id, {
      status: "revision_requested",
      notes: note
        ? `${ticket.notes ? `${ticket.notes}\n\n` : ""}Revision: ${note}`
        : ticket.notes,
    });
    await persistReviewAnnotations(id, dbUser.id, body.annotations);
    await notifyTeamOfReview("revise", note ?? null);
    try {
      const staff = await getStaffUsers();
      await Promise.allSettled(
        staff.map((s) =>
          createNotification({
            userId: s.id,
            type: "ticket_status",
            payload: {
              ticketId: id,
              ticketNumber: ticket.ticketNumber,
              status: "revision_requested",
            },
          }),
        ),
      );
    } catch (err) {
      console.error("revise: in-app notify failed", { ticketId: id, err });
    }
    return Response.json({ ticket: updated });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
