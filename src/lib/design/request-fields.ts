import { type AspectRatio, isAspectRatio } from "@/lib/ai/image/types";
import { type AttachmentRef, isAttachmentType } from "@/lib/design/attachments";
import { isUuid } from "@/lib/validation/uuid";

/* The context fields POST /api/design/generate and POST /api/design/outline
   both take. One parser, so an outline is planned against exactly the
   context its generate request will resolve. */

export const MAX_FREEFORM_LENGTH = 1000;
/** Enough for a brief, a calendar item, a campaign and a few assets. A bound
 *  matters here because each attachment costs a query and prompt budget. */
export const MAX_ATTACHMENTS = 10;

/* Far above any set a job delivers (FRAME_BOUNDS clamps it); this only
   refuses a number that is not a count of frames. */
const MAX_FRAMES_ASKED = 100;

/**
 * Validates the client's attachment list. Returns null when anything is
 * malformed, so a bad payload is a 400 rather than a partially-honoured
 * request. Ownership is proved later, per type, in resolveDesignContext.
 */
export function parseAttachments(value: unknown): AttachmentRef[] | null {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const refs: AttachmentRef[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return null;
    const { type, id } = entry as Record<string, unknown>;
    if (!isAttachmentType(type)) return null;
    if (typeof id !== "string" || !isUuid(id)) return null;
    refs.push({ type, id });
  }
  return refs;
}

/** The frame count a carousel or presentation was asked for: undefined when
 *  none was sent, null when it is not a whole positive number. */
export function parseFrames(value: unknown): number | undefined | null {
  if (value == null) return undefined;
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_FRAMES_ASKED
    ? value
    : null;
}

export interface DesignContextBody {
  brandId?: string;
  briefId?: string | null;
  calendarItemId?: string | null;
  attachments?: unknown;
  freeform?: string | null;
  aspectRatio?: string | null;
}

export interface DesignContextFields {
  brandId: string;
  briefId: string | null | undefined;
  calendarItemId: string | null | undefined;
  attachments: AttachmentRef[];
  freeform: string | null | undefined;
  aspectRatio: AspectRatio | null | undefined;
}

/** The context fields of a design request, or the 400 message for the
 *  first one that is malformed. */
export function parseContextFields(
  body: DesignContextBody,
): { ok: true; fields: DesignContextFields } | { ok: false; error: string } {
  const { brandId, briefId, calendarItemId, freeform, aspectRatio } = body;
  const attachments = parseAttachments(body.attachments);
  if (attachments === null) return { ok: false, error: "Invalid attachments" };
  if (attachments.length > MAX_ATTACHMENTS) {
    return { ok: false, error: `Attach at most ${MAX_ATTACHMENTS} items.` };
  }
  if (!brandId || !isUuid(brandId)) {
    return { ok: false, error: "Missing or invalid brandId" };
  }
  for (const [name, value] of [
    ["briefId", briefId],
    ["calendarItemId", calendarItemId],
  ] as const) {
    if (value != null && !isUuid(value)) {
      return { ok: false, error: `Invalid ${name}` };
    }
  }
  if (freeform != null && freeform.length > MAX_FREEFORM_LENGTH) {
    return {
      ok: false,
      error: `Prompt must be ${MAX_FREEFORM_LENGTH} characters or fewer`,
    };
  }
  if (aspectRatio != null && !isAspectRatio(aspectRatio)) {
    return { ok: false, error: "Invalid aspectRatio" };
  }
  return {
    ok: true,
    fields: {
      brandId,
      briefId,
      calendarItemId,
      attachments,
      freeform,
      aspectRatio,
    },
  };
}
