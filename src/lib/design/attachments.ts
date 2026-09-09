import type { AspectRatio } from "@/lib/ai/image/types";
import { aspectRatioFromDimensions } from "@/lib/design/aspect-ratio";

export const ATTACHMENT_TYPES = [
  "brief",
  "calendar_item",
  "ticket",
  "strategy",
  "asset",
] as const;

export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

export function isAttachmentType(value: unknown): value is AttachmentType {
  return ATTACHMENT_TYPES.includes(value as AttachmentType);
}

/** What the client sends: an id and what kind of thing it is. */
export interface AttachmentRef {
  type: AttachmentType;
  id: string;
}

/** One attachment after its row has been loaded and checked against the brand. */
export interface ResolvedAttachment {
  type: AttachmentType;
  id: string;
  /** Short human name, used as the heading above this block in the brief. */
  label: string;
  /** The prose this attachment contributes. Empty for an image-only asset. */
  text: string | null;
  designType?: string | null;
  dimensions?: string | null;
  platform?: string | null;
  scheduledFor?: string | null;
  /** Assets only: the file the model should see. */
  fileUrl?: string | null;
}

/**
 * Which attachment wins when several supply the same scalar.
 *
 * Ordered most to least specific about the artefact being made. A brief is a
 * direct statement of what to design; a calendar item pins a slot, platform and
 * date; a ticket is a formal request; a strategy is the broadest framing. An
 * asset contributes an image, never a scalar.
 *
 * This has to be explicit rather than "whatever the array order happens to be",
 * or attaching the same two things in a different order would silently produce
 * a different design.
 */
const PRECEDENCE: AttachmentType[] = [
  "brief",
  "calendar_item",
  "ticket",
  "strategy",
  "asset",
];

export function sortByPrecedence(
  attachments: ResolvedAttachment[],
): ResolvedAttachment[] {
  return [...attachments].sort(
    (a, b) => PRECEDENCE.indexOf(a.type) - PRECEDENCE.indexOf(b.type),
  );
}

function firstDefined<K extends keyof ResolvedAttachment>(
  ordered: ResolvedAttachment[],
  key: K,
): string | null {
  for (const attachment of ordered) {
    const value = attachment[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

export interface MergedContext {
  briefText: string | null;
  title: string | null;
  designType: string | null;
  dimensions: string | null;
  platform: string | null;
  scheduledFor: string | null;
  aspectRatio: AspectRatio;
  referenceUrls: string[];
}

/**
 * Folds the user's prompt and every attachment into one brief.
 *
 * The prompt leads: it is what the user asked for just now, and burying it
 * under attached documents makes the model answer the documents instead.
 * Attachments follow under labelled headings so the model can tell a campaign
 * strategy from a calendar slot rather than reading one undifferentiated wall.
 */
export function mergeAttachments(input: {
  freeform?: string | null;
  attachments: ResolvedAttachment[];
  aspectRatio?: AspectRatio | null;
}): MergedContext {
  const ordered = sortByPrecedence(input.attachments);
  const freeform = input.freeform?.trim() || null;

  const parts: { label: string; text: string }[] = [];
  if (freeform) parts.push({ label: "Your prompt", text: freeform });
  for (const attachment of ordered) {
    const text = attachment.text?.trim();
    if (text) parts.push({ label: attachment.label, text });
  }

  /* Headings only earn their place once there is more than one source to tell
     apart. A single brief or calendar item reads as itself, exactly as it did
     before attachments existed. */
  const blocks =
    parts.length > 1
      ? parts.map((p) => `## ${p.label}\n\n${p.text}`)
      : parts.map((p) => p.text);

  const dimensions = firstDefined(ordered, "dimensions");

  return {
    briefText: blocks.length > 0 ? blocks.join("\n\n") : null,
    // The prompt is the user's ask, not a name, so a title only ever comes
    // from an attachment.
    title: ordered[0]?.label ?? null,
    designType: firstDefined(ordered, "designType"),
    dimensions,
    platform: firstDefined(ordered, "platform"),
    scheduledFor: firstDefined(ordered, "scheduledFor"),
    // An explicit choice in the UI beats anything inferred from an attachment.
    aspectRatio: input.aspectRatio ?? aspectRatioFromDimensions(dimensions),
    referenceUrls: ordered
      .map((a) => a.fileUrl)
      .filter((url): url is string => Boolean(url)),
  };
}
