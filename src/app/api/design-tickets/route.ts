import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { getAnalyticsSessionId } from "@/lib/analytics/session-id";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  checkBrandAccess,
  getCalendarItemById,
  getDesignBriefById,
} from "@/lib/db/queries";
import { createTicketFromRequest } from "@/lib/design/ticket-create";
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
  /** Persisted Design Brief Card this submission came from, if any. */
  briefId?: string | null;
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

  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }
  const brand = access.brand;

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

  // If submitted from a persisted Design Brief Card, verify it belongs to
  // this brand so the card can record the resulting ticket.
  let briefId: string | null = null;
  if (body.briefId) {
    const briefRow = await getDesignBriefById(body.briefId);
    if (!briefRow || briefRow.brandId !== brand.id) {
      return Response.json({ error: "Brief not found" }, { status: 404 });
    }
    briefId = briefRow.id;
  }

  try {
    const { ticket } = await createTicketFromRequest(
      {
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
        briefId,
      },
      {
        brandName: brand.name,
        requesterName: `${dbUser.firstName} ${dbUser.lastName}`.trim(),
        requesterEmail: dbUser.email,
      },
    );
    await captureServerEvent({
      distinctId: dbUser.id,
      event: "design_ticket_submitted",
      properties: {
        brand_id: brand.id,
        design_type: designType,
        from_calendar_item: calendarItemId !== null,
        session_id: await getAnalyticsSessionId(),
      },
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
