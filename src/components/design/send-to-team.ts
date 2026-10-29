import type { SerializedGeneration } from "@/lib/design/serialize";

/** What the entry point knows about the work, carried into the ticket so the
 *  design team does not have to ask for it again. */
export interface TicketContext {
  briefId?: string | null;
  calendarItemId?: string | null;
  designType?: string | null;
  dimensions?: string | null;
  brief?: string | null;
}

/**
 * Opens a design ticket with a generated design attached as its reference.
 * Resolves to the ticket's display number when the server returns one.
 */
export async function sendGenerationToTeam({
  brandId,
  generation,
  ticketContext,
}: {
  brandId: string;
  generation: SerializedGeneration;
  ticketContext?: TicketContext;
}): Promise<number | null> {
  const res = await fetch("/api/design-tickets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      brandId,
      briefId: ticketContext?.briefId ?? undefined,
      calendarItemId: ticketContext?.calendarItemId ?? undefined,
      designType:
        ticketContext?.designType ?? generation.designType ?? "Social post",
      dimensions: ticketContext?.dimensions ?? undefined,
      brief:
        ticketContext?.brief ??
        generation.headline ??
        "Polish the attached AI-generated design.",
      referenceImageUrl: generation.url,
      generationId: generation.id,
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Could not send to the design team.");
  }
  const { ticket } = (await res.json()) as {
    ticket?: { ticketNumber?: number };
  };
  return ticket?.ticketNumber ?? null;
}

export function sentToTeamMessage(ticketNumber: number | null): string {
  return ticketNumber
    ? `Sent to the design team as DT-${ticketNumber}`
    : "Sent to the design team";
}
