import type { designGenerations } from "@/lib/db/schema";
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
  createdAt: string;
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
    createdAt: row.createdAt.toISOString(),
  };
}
