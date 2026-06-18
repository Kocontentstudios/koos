import { getAuthUser } from "@/lib/auth/get-user";
import {
  getBrandById,
  getDesignTicketById,
  updateCalendarItemStatus,
  updateDesignTicket,
} from "@/lib/db/queries";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { id } = await params;

  let body: { action?: "approve" | "revise"; note?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const ticket = await getDesignTicketById(id);
  if (!ticket || ticket.userId !== dbUser.id) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }
  // Defense in depth: the ticket's brand must belong to this user.
  const brand = await getBrandById(ticket.brandId);
  if (!brand || brand.userId !== dbUser.id) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }

  if (body.action === "approve") {
    const updated = await updateDesignTicket(id, { status: "delivered" });
    if (ticket.calendarItemId) {
      await updateCalendarItemStatus(ticket.calendarItemId, "ready");
    }
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
    return Response.json({ ticket: updated });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
