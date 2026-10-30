/**
 * How many rows GET /api/design/generations answers by id in one request.
 * The route rejects more, so a client that may ask for more (the set
 * watcher, across several sets building at once) splits its ask with
 * `chunkIds` rather than keeping a second copy of the number.
 */
export const MAX_GENERATION_IDS = 20;

export function chunkIds(
  ids: readonly string[],
  size = MAX_GENERATION_IDS,
): string[][] {
  const chunks: string[][] = [];
  for (let at = 0; at < ids.length; at += size) {
    chunks.push(ids.slice(at, at + size));
  }
  return chunks;
}
