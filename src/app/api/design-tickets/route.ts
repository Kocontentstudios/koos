import { getAuthUser } from "@/lib/auth/get-user";
import {
  createDesignTicket,
  getBrandById,
  getCalendarItemById,
  recordUsageEvent,
} from "@/lib/db/queries";

interface Body {
  brandId?: string;
  calendarItemId?: string | null;
  designType?: string;
  dimensions?: string | null;
  slides?: number | null;
  brief?: string;
  notes?: string | null;
  dueDate?: string | null;
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
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      status: "submitted",
    });
    await recordUsageEvent({
      userId: dbUser.id,
      brandId: brand.id,
      kind: "design_ticket_created",
      metadata: { designType, ticketId: ticket.id },
    });
    return Response.json({ ticket });
  } catch (err) {
    console.error("create design ticket failed", err);
    return Response.json(
      { error: "Could not submit your request. Please try again." },
      { status: 500 },
    );
  }
}
