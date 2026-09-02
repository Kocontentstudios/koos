import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { getAnalyticsSessionId } from "@/lib/analytics/session-id";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  checkBrandAccess,
  getCalendarById,
  getCalendarItemById,
  getDesignBriefById,
  getDesignGenerationById,
} from "@/lib/db/queries";
import {
  attachmentKeyBelongsToUser,
  designRequestSchema,
  draftRequestSchema,
} from "@/lib/design/request-form";
import { serializeGeneration } from "@/lib/design/serialize";
import { createTicketFromRequest } from "@/lib/design/ticket-create";
import { isValidEmail } from "@/lib/validation/email";

interface LegacyBody {
  calendarItemId?: string | null;
  dimensions?: string | null;
  slides?: number | null;
  notes?: string | null;
  deliveryEmail?: string | null;
  /** Persisted Design Brief Card this submission came from, if any. */
  briefId?: string | null;
  /** Generated design or upload the designer should work from. */
  referenceImageUrl?: string | null;
  /** AI generation this reference came from, verified against the brand. */
  generationId?: string | null;
  designType?: string;
  saveAsDraft?: boolean;
}

/* Sends the design-request emails through createTicketFromRequest. Vercel's
   default budget is shorter than the SMTP socket timeout in email.ts, so
   without this a stalled send is killed before it can be logged. */
export const maxDuration = 60;

export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const legacy = json as LegacyBody;
  // Older callers (chat brief panel, calendar modal) send requestType as
  // designType; normalize before validating against the shared schema.
  const normalized = {
    requestType: legacy.designType,
    ...(json as Record<string, unknown>),
  };

  const isDraft = legacy.saveAsDraft === true;
  const parsed = isDraft
    ? draftRequestSchema.safeParse(normalized)
    : designRequestSchema.safeParse(normalized);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join(".");
    return Response.json(
      { error: where ? `${where}: ${first.message}` : "Invalid request" },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const access = await checkBrandAccess(
    dbUser.id,
    body.brandId,
    "manage_content",
  );
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }
  const brand = access.brand;

  for (const attachment of body.attachments ?? []) {
    if (
      attachment.kind === "file" &&
      !attachmentKeyBelongsToUser(attachment.key, dbUser.id)
    ) {
      return Response.json({ error: "Invalid attachment" }, { status: 403 });
    }
  }

  const deliveryEmail = legacy.deliveryEmail?.trim() || null;
  if (deliveryEmail && !isValidEmail(deliveryEmail)) {
    return Response.json(
      { error: "Enter a valid delivery email address." },
      { status: 400 },
    );
  }

  // If linked to a calendar item, make sure it belongs to this brand. The
  // item alone does not carry a brandId — ownership lives on its calendar.
  let calendarItemId: string | null = null;
  if (legacy.calendarItemId) {
    const item = await getCalendarItemById(legacy.calendarItemId);
    const calendar = item ? await getCalendarById(item.calendarId) : null;
    if (!item || !calendar || calendar.brandId !== brand.id) {
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
  if (legacy.briefId) {
    const briefRow = await getDesignBriefById(legacy.briefId);
    if (!briefRow || briefRow.brandId !== brand.id) {
      return Response.json({ error: "Brief not found" }, { status: 404 });
    }
    briefId = briefRow.id;
  }

  // A generation id is trusted over a caller-supplied URL: resolving it
  // server-side stops a client pointing a ticket at someone else's asset.
  let referenceImageUrl = legacy.referenceImageUrl?.trim() || null;
  if (legacy.generationId) {
    const generation = await getDesignGenerationById(legacy.generationId);
    if (!generation || generation.brandId !== brand.id) {
      return Response.json({ error: "Generation not found" }, { status: 404 });
    }
    referenceImageUrl =
      (await serializeGeneration(generation)).url ?? referenceImageUrl;
  }

  const designType = body.requestType ?? legacy.designType ?? "Custom Request";
  try {
    const { ticket } = await createTicketFromRequest(
      {
        brandId: brand.id,
        userId: dbUser.id,
        calendarItemId,
        designType,
        title: body.title ?? null,
        priority: body.priority ?? "normal",
        specs: body.specs ?? null,
        attachments: body.attachments ?? [],
        saveAsDraft: isDraft,
        dimensions: legacy.dimensions ?? body.specs?.dimensions ?? null,
        slides: legacy.slides ?? null,
        brief: body.brief ?? "",
        notes: legacy.notes ?? null,
        deliveryEmail,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        briefId,
        referenceImageUrl,
      },
      {
        brandName: brand.name,
        requesterName: `${dbUser.firstName} ${dbUser.lastName}`.trim(),
        requesterEmail: dbUser.email,
      },
    );
    await captureServerEvent({
      distinctId: dbUser.id,
      event: isDraft ? "design_ticket_draft_saved" : "design_ticket_submitted",
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
