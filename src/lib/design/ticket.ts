/** Human-readable ticket id, e.g. 124 → "DT-00124". Never truncates. */
export function formatTicketNumber(n: number): string {
  return `DT-${String(n).padStart(5, "0")}`;
}
