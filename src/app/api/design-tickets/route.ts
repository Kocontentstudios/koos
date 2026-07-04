import { getAuthUser } from "@/lib/auth/get-user";
import {
  createDesignTicket,
  getBrandById,
  getCalendarItemById,
  recordUsageEvent,
} from "@/lib/db/queries";
import { appUrl, sendDesignRequestEmails } from "@/lib/design/notify";
import { isValidEmail } from "@/lib/validation/email";

interface Body {
  brandId?: string;
  calendarItemId?: string | null;
  designType?: string;
  dimensions?: string | null;
  slides?: number | null;
  brief?: string;
  notes?: string | null;
  dueDate?: string | null;
  deliveryEmail?: string | null;
}

export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { brandId, designType, brief } = body;
  if (!brandId || !designType || !brief) {
    return Response.json(
      { error: "Missing brandId, designType, or brief" },
      { status: 400 },
    );
  }

  const brand = await getBrandById(brandId);
  if (!brand || brand.userId !== dbUser.id) {
    return Response.json({ error: "Brand not found" }, { status: 404 });
  }

  const deliveryEmail = body.deliveryEmail?.trim() || null;
  if (deliveryEmail && !isValidEmail(deliveryEmail)) {
    return Response.json(
      { error: "Enter a valid delivery email address." },
      { status: 400 },
    );
  }

  // If linked to a calendar item, make sure it belongs to this brand.
  let calendarItemId: string | null = null;
  if (body.calendarItemId) {
    const item = await getCalendarItemById(body.calendarItemId);
    if (!item) {
      return Response.json(
        { error: "Calendar item not found" },
        { status: 404 },
      );
    }
    calendarItemId = item.id;
  }

  try {
    const ticket = await createDesignTicket({
      brandId: brand.id,
      userId: dbUser.id,
      calendarItemId,
      designType,
      dimensions: body.dimensions ?? null,
      slides: body.slides ?? null,
      brief,
      notes: body.notes ?? null,
      deliveryEmail,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      status: "submitted",
    });
    await recordUsageEvent({
      userId: dbUser.id,
      brandId: brand.id,
      kind: "design_ticket_created",
      metadata: { designType, ticketId: ticket.id },
    });
    try {
      await sendDesignRequestEmails({
        ticketNumber: ticket.ticketNumber,
        requesterName: `${dbUser.firstName} ${dbUser.lastName}`.trim(),
        requesterEmail: dbUser.email,
        deliveryEmail: ticket.deliveryEmail,
        brandName: brand.name,
        designType: ticket.designType,
        dimensions: ticket.dimensions,
        slides: ticket.slides,
        brief: ticket.brief,
        notes: ticket.notes,
        dueDate: ticket.dueDate,
        adminUrl: appUrl("/admin/tickets"),
        ticketUrl: appUrl(`/design-request/${ticket.id}`),
      });
    } catch (err) {
      console.error("design request emails failed", {
        ticketId: ticket.id,
        err,
      });
    }
    return Response.json({ ticket });
  } catch (err) {
    console.error("create design ticket failed", err);
    return Response.json(
      { error: "Could not submit your request. Please try again." },
      { status: 500 },
    );
  }
}
