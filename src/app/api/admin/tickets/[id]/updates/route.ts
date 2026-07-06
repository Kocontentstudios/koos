import { getAuthUser } from "@/lib/auth/get-user";
import {
  getDesignTicketById,
  getUserById,
  postTicketProgressUpdate,
} from "@/lib/db/queries";
import { appUrl, sendTicketProgressEmail } from "@/lib/design/notify";

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
  if (message.length > 2000) {
    return Response.json(
      { error: "Message is too long (2000 characters max)." },
      { status: 400 },
    );
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

  await postTicketProgressUpdate({
    ticketId: id,
    authorId: dbUser.id,
    message,
    newStatus,
    ownerId: ticket.userId,
    notificationPayload: {
      ticketId: id,
      ticketNumber: ticket.ticketNumber,
      designType: ticket.designType,
      status: newStatus ?? undefined,
      message,
    },
  });

  // Email the requester (non-blocking — the update is already persisted).
  try {
    const owner = await getUserById(ticket.userId);
    const to = ticket.deliveryEmail || owner?.email;
    if (to) {
      await sendTicketProgressEmail({
        to,
        input: {
          ticketNumber: ticket.ticketNumber,
          designType: ticket.designType,
          message,
          status: newStatus,
          ticketUrl: appUrl(`/design-request/${id}`),
        },
      });
    }
  } catch (err) {
    console.error("updates: progress email failed", { ticketId: id, err });
  }

  return Response.json({ ok: true });
}
