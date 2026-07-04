import { getAuthUser } from "@/lib/auth/get-user";
import {
  createNotification,
  createTicketUpdate,
  getDesignTicketById,
  updateDesignTicket,
} from "@/lib/db/queries";

// Statuses a designer/admin may set alongside a progress update (mirrors the
// status route's DESIGNER_SETTABLE). Broader admin overrides land in Part D.
const SETTABLE = ["assigned", "in_progress", "ready_for_review"] as const;
type SettableStatus = (typeof SETTABLE)[number];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser || (dbUser.role !== "designer" && dbUser.role !== "admin")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let body: { message?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return Response.json({ error: "A message is required." }, { status: 400 });
  }

  let newStatus: SettableStatus | null = null;
  if (body.status) {
    if (!(SETTABLE as readonly string[]).includes(body.status)) {
      return Response.json({ error: "Invalid status" }, { status: 400 });
    }
    newStatus = body.status as SettableStatus;
  }

  const ticket = await getDesignTicketById(id);
  if (!ticket) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }

  if (newStatus) {
    await updateDesignTicket(id, { status: newStatus });
  }
  await createTicketUpdate({
    ticketId: id,
    authorId: dbUser.id,
    message,
    newStatus,
  });
  await createNotification({
    userId: ticket.userId,
    type: "ticket_status",
    payload: {
      ticketId: id,
      ticketNumber: ticket.ticketNumber,
      designType: ticket.designType,
      status: newStatus ?? undefined,
      message,
    },
  });

  return Response.json({ ok: true });
}
