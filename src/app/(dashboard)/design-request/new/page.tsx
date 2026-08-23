import { notFound } from "next/navigation";
import { requireBrand } from "@/lib/auth/require-brand";
import {
  checkBrandAccess,
  getDesignTicketById,
  listTicketAttachments,
} from "@/lib/db/queries";
import { getBrandsForMember } from "@/lib/db/queries/workspaces";
import type { AttachmentInput } from "@/lib/design/request-form";
import type { TicketPriority } from "@/lib/design/tickets-ui";
import { type InitialDraft, RequestFormClient } from "./request-form-client";

async function loadDraft(
  draftId: string,
  userId: string,
): Promise<InitialDraft | null> {
  const ticket = await getDesignTicketById(draftId);
  if (!ticket || ticket.userId !== userId || ticket.status !== "draft") {
    return null;
  }
  /* Authoring the draft is not enough to keep reading it: a member narrowed
     out of this brand still owns rows whose brief, specs and attachment keys
     they may no longer see. Same rule the DELETE route applies. */
  const access = await checkBrandAccess(
    userId,
    ticket.brandId,
    "manage_content",
  );
  if (!access.ok) return null;
  const rows = await listTicketAttachments(ticket.id);
  const attachments: AttachmentInput[] = rows.map((row) =>
    row.kind === "file"
      ? {
          kind: "file",
          key: row.fileKey ?? "",
          fileName: row.fileName ?? "file",
          mimeType: row.mimeType ?? "application/octet-stream",
          sizeBytes: row.sizeBytes ?? 1,
          category: row.category,
          note: row.note ?? undefined,
        }
      : {
          kind: "link",
          url: row.url ?? "",
          category: row.category,
          note: row.note ?? undefined,
        },
  );
  const referenceNote =
    rows.find((r) => r.category === "reference" && r.note)?.note ?? "";
  return {
    id: ticket.id,
    state: {
      requestType: ticket.designType,
      title: ticket.title ?? "",
      brandId: ticket.brandId,
      dueDate: ticket.dueDate ? ticket.dueDate.toISOString().slice(0, 10) : "",
      priority: ticket.priority as TicketPriority,
      brief: ticket.brief,
      attachments,
      referenceNote,
      specs: {
        platform: ticket.specs?.platform ?? "",
        dimensions: ticket.specs?.dimensions ?? "",
        orientation: ticket.specs?.orientation ?? "",
        fileFormat: ticket.specs?.fileFormat ?? "",
        deliverablesCount: ticket.specs?.deliverablesCount
          ? String(ticket.specs.deliverablesCount)
          : "",
      },
    },
  };
}

export default async function NewDesignRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const { dbUser, workspace, brand } = await requireBrand();
  const brands = await getBrandsForMember(workspace.id, dbUser.id);
  const { draft: draftParam } = await searchParams;

  let initialDraft: InitialDraft | null = null;
  if (draftParam) {
    initialDraft = await loadDraft(draftParam, dbUser.id);
    if (!initialDraft) notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <header className="space-y-1">
        <h1 className="font-display text-[28px] font-bold text-foreground">
          {initialDraft ? "Finish Your Design Request" : "New Design Request"}
        </h1>
        <p className="text-[15px] text-[var(--text-secondary)]">
          Type or paste your design brief, upload your files, and send
          everything directly to the creative team.
        </p>
      </header>
      <RequestFormClient
        brands={brands.map((b) => ({ id: b.id, name: b.name }))}
        defaultBrandId={initialDraft?.state.brandId ?? brand?.id ?? ""}
        initialDraft={initialDraft}
      />
    </div>
  );
}
