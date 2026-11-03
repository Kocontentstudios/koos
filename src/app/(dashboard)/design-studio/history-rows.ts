import type { designGenerations } from "@/lib/db/schema";
import { liveFrames } from "@/lib/design/sequence/frames";

type GenerationRow = typeof designGenerations.$inferSelect;

/**
 * The newest designs, with each set among them made whole: the page of 24
 * can cut a carousel in two, and holds its replaced frames too. A set takes
 * the place of its newest row and brings exactly the frames on show, failed
 * ones included so the viewer can offer a retry.
 */
export async function historyRows<R extends GenerationRow>(
  newest: R[],
  setFrames: (setId: string) => Promise<R[]>,
): Promise<R[]> {
  const setIds = [
    ...new Set(newest.flatMap((row) => (row.setId ? [row.setId] : []))),
  ];
  const sets = new Map(
    await Promise.all(
      setIds.map(
        async (setId) => [setId, liveFrames(await setFrames(setId))] as const,
      ),
    ),
  );
  const placed = new Set<string>();
  return newest.flatMap((row) => {
    if (!row.setId) return [row];
    if (placed.has(row.setId)) return [];
    placed.add(row.setId);
    return sets.get(row.setId) ?? [];
  });
}
