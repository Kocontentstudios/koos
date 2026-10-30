import type { designGenerations } from "@/lib/db/schema";
import { readRationale } from "@/lib/design/direction-rationale";
import type { SerializedFrame } from "@/lib/design/sequence/contract";
import { serializedFrameOf } from "@/lib/design/sequence/frames";
import type { DesignSpec } from "@/lib/design/spec";
import { getSignedReadUrl, publicUrl } from "@/lib/storage";

type GenerationRow = typeof designGenerations.$inferSelect;

export interface SerializedGeneration {
  id: string;
  url: string | null;
  renderer: GenerationRow["renderer"];
  provider: string;
  model: string;
  status: GenerationRow["status"];
  error: string | null;
  width: number | null;
  height: number | null;
  designType: string | null;
  briefId: string | null;
  calendarItemId: string | null;
  headline: string | null;
  /** The frame editor prefills from these (KOOS-AI-002): a user editing a
   *  frame sees the line they are changing. Null when the spec has none. */
  subheadline: string | null;
  cta: string | null;
  createdAt: string;
  /** A direction's name and "why this works" list; null on variant rows. */
  direction: { title: string; reasons: string[] } | null;
  imageSource: "upload" | "ko" | "none" | null;
  /** Whether a layer document exists to edit. Old rows have none. */
  editable: boolean;
  /** Which carousel or presentation frame this is; null on single designs. */
  frame: SerializedFrame | null;
}

/** Signed URLs are minted per request rather than stored, so a gallery link
 * never goes stale the way a persisted signed URL would. */
async function resolveUrl(key: string | null): Promise<string | null> {
  if (!key) return null;
  if (process.env.R2_PUBLIC_BASE_URL) return publicUrl(key);
  try {
    return await getSignedReadUrl(key, 3600);
  } catch {
    return null;
  }
}

/* Only the two fields the card shows. The set and slot that pair a
   direction with its sibling are the server's business. */
function directionOf(value: unknown): SerializedGeneration["direction"] {
  const rationale = readRationale(value);
  return rationale
    ? { title: rationale.title, reasons: rationale.reasons }
    : null;
}

export async function serializeGeneration(
  row: GenerationRow,
): Promise<SerializedGeneration> {
  const spec = row.spec as Partial<DesignSpec> | null;
  return {
    id: row.id,
    url: await resolveUrl(row.imageKey),
    renderer: row.renderer,
    provider: row.provider,
    model: row.model,
    status: row.status,
    error: row.error,
    width: row.width,
    height: row.height,
    designType: row.designType,
    briefId: row.briefId,
    calendarItemId: row.calendarItemId,
    headline: spec?.headline ?? null,
    subheadline: spec?.subheadline ?? null,
    cta: spec?.cta ?? null,
    createdAt: row.createdAt.toISOString(),
    direction: directionOf(row.rationale),
    imageSource: row.imageSource ?? null,
    editable: row.document !== null && row.document !== undefined,
    frame: serializedFrameOf(row),
  };
}
