/** Human-readable ticket id, e.g. 124 → "DT-00124". Never truncates. */
export function formatTicketNumber(n: number): string {
  return `DT-${String(n).padStart(5, "0")}`;
}

/** Filename for the all-deliverables zip, e.g. "DT-00124-deliverables.zip". */
export function deliverablesZipName(n: number): string {
  return `${formatTicketNumber(n)}-deliverables.zip`;
}
