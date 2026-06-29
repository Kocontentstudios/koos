import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireBrand } from "@/lib/auth/require-brand";
import { getDesignTicketsByUser } from "@/lib/db/queries";
import type { TicketStatus } from "@/lib/design/tickets-ui";
import { type TicketListRow, TicketsListClient } from "./tickets-list-client";

export default async function DesignRequestPage() {
  const { dbUser } = await requireBrand();
  const rows = await getDesignTicketsByUser(dbUser.id);

  const tickets: TicketListRow[] = rows.map(
    ({ ticket, campaignName, itemTitle }) => ({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      designType: ticket.designType,
      slides: ticket.slides ?? null,
      status: ticket.status as TicketStatus,
      campaignName: campaignName ?? null,
      itemTitle: itemTitle ?? null,
      createdAt: ticket.createdAt.toISOString(),
      dueDate: ticket.dueDate ? ticket.dueDate.toISOString() : null,
    }),
  );

  return (
    <div className="flex w-full flex-col gap-6">
      <header className="space-y-1">
        <h1 className="font-display text-[28px] font-bold text-foreground">
          Design Tickets
        </h1>
        <p className="text-[15px] text-[var(--text-secondary)]">
          Track all your design requests.
        </p>
      </header>

      {tickets.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-[var(--border)] bg-surface-1 px-6 py-16 text-center">
          <p className="text-[15px] text-[var(--text-secondary)]">
            You have not requested any designs yet.
          </p>
          <Link href="/calendar">
            <Button variant="default" size="lg">
              Go to Calendar
            </Button>
          </Link>
        </div>
      ) : (
        <TicketsListClient tickets={tickets} />
      )}
    </div>
  );
}
