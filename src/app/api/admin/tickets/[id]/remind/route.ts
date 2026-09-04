import { formatOverdue, overdueMs } from "@/lib/admin/scope";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  createNotification,
  getBrandById,
  getDesignTicketById,
  getNotifications,
  getUserById,
} from "@/lib/db/queries";
import { appUrl, sendTicketReminderEmail } from "@/lib/design/notify";
import { formatTicketNumber } from "@/lib/design/ticket";

/* This route sends mail. Vercel's default budget is shorter than the SMTP
   socket timeout in email.ts, so without this a stalled send is killed before
   the handler can log or report it. */
export const maxDuration = 60;

/** Two clicks in quick succession are one intent, not two nudges. */
const COOLING_OFF_MS = 6 * 60 * 60 * 1000;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser || (dbUser.role !== "designer" && dbUser.role !== "admin")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const ticket = await getDesignTicketById(id);
  if (!ticket) {
    return Response.json({ error: "Ticket not found" }, { status: 404 });
  }

  /* Nobody is carrying it, so there is nobody to nudge. Saying so beats
     doing nothing and reporting success. */
  if (!ticket.assignedDesignerId) {
    return Response.json(
      { error: "Assign the ticket before sending a reminder." },
      { status: 409 },
    );
  }

  /* Read from the notification the last reminder wrote, not from module
     state: every serverless instance has its own memory, so an in-process
     guard lets a second instance send the same nudge seconds later. */
  const recent = await getNotifications(ticket.assignedDesignerId, 20);
  const alreadyNudged = recent.some(
    (n) =>
      n.type === "ticket_status" &&
      (n.payload as { ticketId?: string; reminder?: boolean } | null)
        ?.reminder === true &&
      (n.payload as { ticketId?: string } | null)?.ticketId === ticket.id &&
      Date.now() - n.createdAt.getTime() < COOLING_OFF_MS,
  );
  if (alreadyNudged) {
    return Response.json(
      { error: "A reminder for this ticket was already sent recently." },
      { status: 429 },
    );
  }

  const [designer, brand] = await Promise.all([
    getUserById(ticket.assignedDesignerId),
    ticket.brandId ? getBrandById(ticket.brandId) : Promise.resolve(null),
  ]);

  const now = new Date();
  const late = overdueMs(ticket.dueDate, now);
  const overdueFor = late === null ? null : formatOverdue(late);
  const ticketUrl = appUrl(`/admin/tickets/${ticket.id}`);

  /* The in-app notification is the durable half: it survives a bounced or
     blocked send, and it is what the designer sees next time they are in the
     product. The email is what reaches someone who is not. */
  await createNotification({
    userId: ticket.assignedDesignerId,
    type: "ticket_status",
    payload: {
      // Marks this row as a reminder so the cooling-off check can find it.
      reminder: true,
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      designType: ticket.designType,
      message: overdueFor
        ? `${formatTicketNumber(ticket.ticketNumber)} is ${overdueFor} overdue.`
        : `Reminder about ${formatTicketNumber(ticket.ticketNumber)}.`,
    },
  });

  if (designer?.email) {
    // Never throws by contract, but the action must not fail on a nudge.
    await sendTicketReminderEmail({
      to: designer.email,
      input: {
        ticketNumber: ticket.ticketNumber,
        designType: ticket.designType,
        brandName: brand?.name ?? null,
        overdueFor,
        dueDate: ticket.dueDate ? ticket.dueDate.toDateString() : null,
        ticketUrl,
      },
    }).catch((err) => {
      console.error("ticket reminder email failed", { id, err });
    });
  }

  return Response.json({ ok: true, overdueFor });
}
