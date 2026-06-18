/** Formats a ticket sequence number as a human-readable id, e.g. DT-00124. */
export function formatTicketNumber(n: number): string {
  return `DT-${String(n).padStart(5, "0")}`;
}
