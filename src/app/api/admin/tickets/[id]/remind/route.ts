import { formatOverdue, overdueMs } from "@/lib/admin/scope";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  createNotification,
  getBrandById,
  getDesignTicketById,
  getUserById,
  releaseRateLimit,
} from "@/lib/db/queries";
import { appUrl, sendTicketReminderEmail } from "@/lib/design/notify";
import { formatTicketNumber } from "@/lib/design/ticket";
import { checkRateLimit } from "@/lib/rate-limit";

/* This route sends mail. Vercel's default budget is shorter than the SMTP
   socket timeout in email.ts, so without this a stalled send is killed before
   the handler can log or report it. */
export const maxDuration = 60;

/** How long one nudge speaks for. A designer chased twice in a morning stops
 *  reading the chases. */
const COOLING_OFF_SECONDS = 6 * 60 * 60;

/* The shared tooManyRequests() says "wait a moment", which is true of a
   per-minute limit and misleading about six hours: the operator waits, clicks,
   sees the same sentence and concludes the button is broken. Say what actually
   happened and when they can try again. */
function alreadyNudged(retryAfterSeconds: number): Response {
  const hours = Math.ceil(retryAfterSeconds / 3600);
  return Response.json(
    {
      error: `A reminder for this ticket already went out. You can send another in ${hours} ${hours === 1 ? "hour" : "hours"}.`,
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    },
  );
}

function formatDueDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

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

  /* One atomic upsert per ticket, not a read-then-write over recent
     notifications: two admins clicking at once both pass a check-then-act
     guard, and a busy designer's reminder row falls out of any bounded recent
     window long before the cooling-off period is up. Keyed on the TICKET so a
     nudge about one ticket never suppresses a nudge about another. */
  const limiterKey = `ticket-remind:${ticket.id}`;
  const verdict = await checkRateLimit({
    key: limiterKey,
    limit: 1,
    windowSeconds: COOLING_OFF_SECONDS,
  });
  if (!verdict.ok) return alreadyNudged(verdict.retryAfterSeconds);

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
  try {
    await createNotification({
      userId: ticket.assignedDesignerId,
      type: "ticket_status",
      payload: {
        reminder: true,
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        designType: ticket.designType,
        message: overdueFor
          ? `${formatTicketNumber(ticket.ticketNumber)} is ${overdueFor} overdue.`
          : `Reminder about ${formatTicketNumber(ticket.ticketNumber)}.`,
      },
    });
  } catch (err) {
    /* The window was reserved before the write, so a failed write has to hand
       it back. Otherwise every retry for the next six hours is refused with
       "a reminder already went out" — which would be false. */
    console.error("ticket reminder notification failed", { id, err });
    await releaseRateLimit(limiterKey).catch((releaseErr) => {
      console.error("ticket reminder limiter release failed", {
        id,
        releaseErr,
      });
    });
    return Response.json(
      {
        error:
          "The reminder could not be recorded. Nothing was sent — try again.",
      },
      { status: 500 },
    );
  }

  if (designer?.email) {
    // Never throws by contract (notify.ts), and logs its own failures.
    await sendTicketReminderEmail({
      to: designer.email,
      input: {
        ticketNumber: ticket.ticketNumber,
        designType: ticket.designType,
        brandName: brand?.name ?? null,
        overdueFor,
        dueDate: ticket.dueDate ? formatDueDate(ticket.dueDate) : null,
        ticketUrl,
      },
    });
  }

  return Response.json({ ok: true, overdueFor });
}
