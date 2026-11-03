import type { designGenerations } from "@/lib/db/schema";
import {
  FRAME_ROLES,
  type FrameBeat,
  type FrameRole,
  type SerializedFrame,
} from "./contract";

type GenerationRow = typeof designGenerations.$inferSelect;

/** What a frame row's rationale column holds. It has no `set`, so the
 *  directions regenerate route, which needs one, refuses a frame. */
export interface FrameRationale {
  title: string;
  reasons: string[];
  role: FrameRole;
}

export function frameRationale(beat: FrameBeat): FrameRationale {
  return { title: beat.title, reasons: [], role: beat.role };
}

function readRole(value: unknown): FrameRole | null {
  if (!value || typeof value !== "object") return null;
  const role = (value as Record<string, unknown>).role;
  return (FRAME_ROLES as readonly unknown[]).includes(role)
    ? (role as FrameRole)
    : null;
}

export function serializedFrameOf(
  row: Pick<GenerationRow, "setId" | "frameIndex" | "frameCount" | "rationale">,
): SerializedFrame | null {
  if (!row.setId || row.frameIndex == null || row.frameCount == null) {
    return null;
  }
  const rationale = row.rationale as Record<string, unknown> | null;
  return {
    setId: row.setId,
    index: row.frameIndex,
    count: row.frameCount,
    role: readRole(rationale) ?? "body",
    title: typeof rationale?.title === "string" ? rationale.title : "",
  };
}

/**
 * The frame on show at each index: the newest row not superseded. A frame
 * whose regenerate is still pending or failed keeps showing the row it
 * would replace, because supersededBy is only written once the new row
 * succeeds. Indexes with no row at all are absent.
 */
export function liveFrames<
  R extends Pick<
    GenerationRow,
    "id" | "frameIndex" | "supersededBy" | "status" | "createdAt"
  >,
>(rows: readonly R[]): R[] {
  const byIndex = new Map<number, R>();
  for (const row of rows) {
    if (row.frameIndex == null || row.supersededBy) continue;
    const held = byIndex.get(row.frameIndex);
    const better =
      !held ||
      (held.status !== "succeeded" && row.status === "succeeded") ||
      (held.status === row.status && row.createdAt > held.createdAt);
    if (better) byIndex.set(row.frameIndex, row);
  }
  return [...byIndex.entries()].sort(([a], [b]) => a - b).map(([, r]) => r);
}
