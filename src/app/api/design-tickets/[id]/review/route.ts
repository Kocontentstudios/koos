import { getAuthUser } from "@/lib/auth/get-user";
import {
  type AnnotationShape,
  addAnnotation,
  applyClientReview,
  checkBrandAccess,
  getDeliverables,
  getDesignTicketById,
  getStaffUsers,
  getUserById,
  updateCalendarItemStatus,
} from "@/lib/db/queries";
import {
  appUrl,
  sendTicketReviewClientEmail,
  sendTicketReviewTeamEmail,
} from "@/lib/design/notify";
import {
  canRequestRevision,
  groupDeliverablesByVersion,
  MAX_DELIVERY_ROUNDS,
} from "@/lib/design/ticket";

const MAX_NOTE_LENGTH = 2000;

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

// Annotations are only meaningful against the round being reviewed. Scoping to
// the latest version's ids stops a page left open from an earlier round (or a
// hand-rolled request) attaching this round's feedback to superseded artwork,
// where it would render under the wrong round on the admin page.
function annotationsForLatestVersion(
  annotations: ReviewAnnotationInput[] | undefined,
  latestDeliverableIds: Set<string>,
): { deliverableId: string; shapes: AnnotationShape[]; note?: string }[] {
  if (!annotations) return [];
  const valid: {
    deliverableId: string;
    shapes: AnnotationShape[];
    note?: string;
  }[] = [];
  for (const annotation of annotations) {
    if (!latestDeliverableIds.has(annotation.deliverableId)) continue;
    const shapes = filterValidShapes(annotation.shapes);
    if (shapes.length === 0) continue;
    valid.push({
      deliverableId: annotation.deliverableId,
      shapes,
      note: annotation.note,
    });
  }
  return valid;
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

  if (body.action !== "approve" && body.action !== "revise") {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }
  const action = body.action;

  const ticket = await getDesignTicketById(id);
  if (!ticket) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }
  /* Sign-off is a different act from iterating on the work: approving is
     what unlocks the deliverable downloads, so it needs approve_deliverables.
     Asking for a revision stays ordinary content work. */
  const access = await checkBrandAccess(
    dbUser.id,
    ticket.brandId,
    action === "approve" ? "approve_deliverables" : "manage_content",
  );
  if (!access.ok) {
    return Response.json(
      { error: access.status === 403 ? access.error : "Ticket not found" },
      { status: access.status },
    );
  }

  const note = body.note?.trim() || null;
  if (note && note.length > MAX_NOTE_LENGTH) {
    return Response.json(
      { error: `Keep your note under ${MAX_NOTE_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const deliverables = await getDeliverables(id);
  const latest = groupDeliverablesByVersion(deliverables)[0] ?? null;
  const validAnnotations =
    action === "revise"
      ? annotationsForLatestVersion(
          body.annotations,
          new Set(latest?.items.map((d) => d.id) ?? []),
        )
      : [];

  // A revision with neither a note nor markup tells the designer nothing.
  if (action === "revise" && !note && validAnnotations.length === 0) {
    return Response.json(
      { error: "Tell the designer what needs changing." },
      { status: 400 },
    );
  }

  if (action === "revise" && !canRequestRevision(latest?.version ?? null)) {
    return Response.json(
      {
        error: `This design has had all ${MAX_DELIVERY_ROUNDS} rounds. Mark it satisfied or contact the design team.`,
      },
      { status: 409 },
    );
  }

  const staff = await getStaffUsers().catch((err) => {
    console.error("review: staff lookup failed", { ticketId: id, err });
    return [];
  });

  const result = await applyClientReview({
    ticketId: id,
    authorId: dbUser.id,
    action,
    note,
    version: latest?.version ?? null,
    staffIds: staff.map((s) => s.id),
    ticketNumber: ticket.ticketNumber,
  });
  if (!result) {
    return Response.json(
      { error: "This design isn't awaiting review." },
      { status: 409 },
    );
  }

  if (action === "revise") {
    for (const annotation of validAnnotations) {
      try {
        await addAnnotation({
          ticketId: id,
          authorId: dbUser.id,
          ...annotation,
        });
      } catch (err) {
        console.error("review: annotation persistence failed", {
          ticketId: id,
          err,
        });
      }
    }
  }

  if (action === "approve" && ticket.calendarItemId) {
    await updateCalendarItemStatus(ticket.calendarItemId, "ready");
  }

  const requesterName = `${dbUser.firstName} ${dbUser.lastName}`.trim();
  try {
    await sendTicketReviewTeamEmail({
      ticketNumber: ticket.ticketNumber,
      designType: ticket.designType,
      action,
      note,
      requesterName,
      requesterEmail: dbUser.email,
      adminUrl: appUrl(`/admin/tickets/${id}`),
    });
  } catch (err) {
    console.error("review: team email failed", { ticketId: id, err });
  }

  try {
    const owner = await getUserById(ticket.userId);
    const confirmTo = ticket.deliveryEmail || owner?.email || dbUser.email;
    await sendTicketReviewClientEmail({
      to: confirmTo,
      input: {
        ticketNumber: ticket.ticketNumber,
        designType: ticket.designType,
        action,
        note,
        version: latest?.version ?? null,
        ticketUrl: appUrl(`/design-request/${id}`),
      },
    });
  } catch (err) {
    console.error("review: client confirmation email failed", {
      ticketId: id,
      err,
    });
  }

  return Response.json({ ticket: result.ticket });
}
