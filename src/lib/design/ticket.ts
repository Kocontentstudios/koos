/** Human-readable ticket id, e.g. 124 → "DT-00124". Never truncates. */
export function formatTicketNumber(n: number): string {
  return `DT-${String(n).padStart(5, "0")}`;
}

/** Filename for a deliverables zip, e.g. "DT-00124-v2-deliverables.zip".
 * The version segment is omitted only when the caller has no version to name. */
export function deliverablesZipName(n: number, version?: number): string {
  const versionPart = version ? `-v${version}` : "";
  return `${formatTicketNumber(n)}${versionPart}-deliverables.zip`;
}

export type DeliverableVersionGroup<T> = {
  version: number;
  /** Earliest createdAt in the batch — when this round landed. */
  deliveredAt: Date;
  items: T[];
};

/** Split a flat deliverable list into delivery rounds, newest round first.
 * Items keep their incoming order within a round. */
export function groupDeliverablesByVersion<
  T extends { version: number; createdAt: Date },
>(rows: T[]): DeliverableVersionGroup<T>[] {
  const byVersion = new Map<number, T[]>();
  for (const row of rows) {
    const bucket = byVersion.get(row.version);
    if (bucket) bucket.push(row);
    else byVersion.set(row.version, [row]);
  }

  return [...byVersion.entries()]
    .map(([version, items]) => ({
      version,
      deliveredAt: items.reduce(
        (earliest, item) =>
          item.createdAt < earliest ? item.createdAt : earliest,
        items[0].createdAt,
      ),
      items,
    }))
    .sort((a, b) => b.version - a.version);
}

/** Highest delivery round on a ticket, or null when nothing is delivered yet. */
export function latestVersion(rows: { version: number }[]): number | null {
  if (rows.length === 0) return null;
  return rows.reduce((max, row) => (row.version > max ? row.version : max), 0);
}

/** Delivery rounds a ticket gets before the client must accept or take it
 * off-platform. Bounds an otherwise open-ended revision loop. */
export const MAX_DELIVERY_ROUNDS = 3;

/** Can the client still send this back for another round? False on the final
 * round, where Satisfied is the only remaining action. */
export function canRequestRevision(version: number | null): boolean {
  if (version === null) return false;
  return version < MAX_DELIVERY_ROUNDS;
}
