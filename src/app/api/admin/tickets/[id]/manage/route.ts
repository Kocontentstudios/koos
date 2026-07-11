import { getAuthUser } from "@/lib/auth/get-user";
import {
  createNotification,
  getDesignTicketById,
  getUserById,
  updateDesignTicket,
} from "@/lib/db/queries";
import { appUrl, sendTicketStatusEmail } from "@/lib/design/notify";

const STATUSES = [
  "submitted",
  "assigned",
  "in_progress",
  "ready_for_review",
  "delivered",
  "revision_requested",
] as const;
type Status = (typeof STATUSES)[number];

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
type Priority = (typeof PRIORITIES)[number];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (dbUser?.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let body: {
    status?: string;
    priority?: string;
    assignedDesignerId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const patch: {
    status?: Status;
    priority?: Priority;
    assignedDesignerId?: string | null;
  } = {};

  if (body.status !== undefined) {
    if (!(STATUSES as readonly string[]).includes(body.status)) {
      return Response.json({ error: "Invalid status" }, { status: 400 });
    }
    patch.status = body.status as Status;
  }
  if (body.priority !== undefined) {
    if (!(PRIORITIES as readonly string[]).includes(body.priority)) {
      return Response.json({ error: "Invalid priority" }, { status: 400 });
    }
    patch.priority = body.priority as Priority;
  }
  if (body.assignedDesignerId !== undefined) {
    if (body.assignedDesignerId === null) {
      patch.assignedDesignerId = null;
    } else {
      const assignee = await getUserById(body.assignedDesignerId);
      if (
        !assignee ||
        (assignee.role !== "designer" && assignee.role !== "admin")
      ) {
        return Response.json({ error: "Invalid assignee" }, { status: 400 });
      }
      patch.assignedDesignerId = body.assignedDesignerId;
    }
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  const ticket = await getDesignTicketById(id);
  if (!ticket) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }

  const updated = await updateDesignTicket(id, patch);

  // Inform the requester when an admin changes the status (non-blocking —
  // a notification failure must not fail the update that already succeeded).
  if (patch.status && patch.status !== ticket.status) {
    try {
      await createNotification({
        userId: ticket.userId,
        type: "ticket_status",
        payload: {
          ticketId: id,
          ticketNumber: ticket.ticketNumber,
          designType: ticket.designType,
          status: patch.status,
        },
      });
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
      console.error("manage: status notification failed", {
        ticketId: id,
        err,
      });
    }
  }

  return Response.json({ ticket: updated });
}
