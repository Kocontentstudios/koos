import { getAuthUser } from "@/lib/auth/get-user";
import {
  getDesignTicketById,
  getUserById,
  updateDesignTicket,
} from "@/lib/db/queries";
import { appUrl, sendTicketStatusEmail } from "@/lib/design/notify";

const DESIGNER_SETTABLE = [
  "assigned",
  "in_progress",
  "ready_for_review",
] as const;
type DesignerStatus = (typeof DESIGNER_SETTABLE)[number];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser || (dbUser.role !== "designer" && dbUser.role !== "admin")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let body: { status?: string; claim?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const ticket = await getDesignTicketById(id);
  if (!ticket) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }

  const patch: { status?: DesignerStatus; assignedDesignerId?: string } = {};

  if (body.claim) {
    patch.assignedDesignerId = dbUser.id;
    patch.status = "assigned";
  }
  if (body.status) {
    if (!(DESIGNER_SETTABLE as readonly string[]).includes(body.status)) {
      return Response.json({ error: "Invalid status" }, { status: 400 });
    }
    patch.status = body.status as DesignerStatus;
  }
  if (!patch.status && !patch.assignedDesignerId) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await updateDesignTicket(id, patch);

  // Email the requester when the visible status actually changed (non-blocking).
  if (patch.status && patch.status !== ticket.status) {
    try {
      const owner = await getUserById(ticket.userId);
      const to = ticket.deliveryEmail || owner?.email;
      if (to) {
        await sendTicketStatusEmail({
          to,
          input: {
            ticketNumber: ticket.ticketNumber,
            designType: ticket.designType,
            status: patch.status,
            ticketUrl: appUrl(`/design-request/${id}`),
          },
        });
      }
    } catch (err) {
      console.error("status: requester email failed", { ticketId: id, err });
    }
  }

  return Response.json({ ticket: updated });
}
