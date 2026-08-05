import { FileText, Link2 } from "lucide-react";
import { listTicketAttachments } from "@/lib/db/queries";
import type { DesignTicketSpecs } from "@/lib/design/request-form";
import { getSignedReadUrl, isStorageConfigured } from "@/lib/storage";

const SPEC_LABELS: [keyof DesignTicketSpecs, string][] = [
  ["platform", "Platform"],
  ["dimensions", "Dimensions"],
  ["orientation", "Orientation"],
  ["fileFormat", "File format"],
  ["deliverablesCount", "Deliverables"],
];

function formatBytes(bytes: number | null): string | null {
  if (!bytes) return null;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

interface ResolvedAttachment {
  id: string;
  kind: "file" | "link";
  category: "asset" | "reference";
  label: string;
  href: string | null;
  sizeLabel: string | null;
  note: string | null;
}

function AttachmentRow({ a }: { a: ResolvedAttachment }) {
  const Icon = a.kind === "file" ? FileText : Link2;
  return (
    <li className="flex flex-col gap-1 rounded-lg bg-surface-2 px-3 py-2">
      <div className="flex items-center gap-2 text-[13px]">
        <Icon size={14} className="shrink-0 text-[var(--text-muted)]" />
        {a.href ? (
          <a
            href={a.href}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate font-medium text-primary hover:underline"
          >
            {a.label}
          </a>
        ) : (
          <span className="min-w-0 flex-1 truncate text-foreground">
            {a.label}
          </span>
        )}
        {a.sizeLabel && (
          <span className="shrink-0 text-[11px] text-[var(--text-muted)]">
            {a.sizeLabel}
          </span>
        )}
      </div>
      {a.note && (
        <p className="pl-6 text-[12px] text-[var(--text-secondary)]">
          {a.note}
        </p>
      )}
    </li>
  );
}

/** Specifications + inbound attachments for a design request, shared by the
 * client and admin ticket detail pages. Server component: resolves signed
 * read URLs for uploaded files. */
export async function TicketRequestDetails({
  ticketId,
  specs,
}: {
  ticketId: string;
  specs: DesignTicketSpecs | null;
}) {
  const rows = await listTicketAttachments(ticketId);
  const storageReady = isStorageConfigured();

  const attachments: ResolvedAttachment[] = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      kind: row.kind,
      category: row.category,
      label:
        row.kind === "file" ? (row.fileName ?? "file") : (row.url ?? "link"),
      href:
        row.kind === "link"
          ? row.url
          : row.fileKey && storageReady
            ? await getSignedReadUrl(row.fileKey, 3600, {
                disposition: "attachment",
                fileName: row.fileName ?? "file",
              })
            : null,
      sizeLabel: row.kind === "file" ? formatBytes(row.sizeBytes) : null,
      note: row.note,
    })),
  );

  const assets = attachments.filter((a) => a.category === "asset");
  const references = attachments.filter((a) => a.category === "reference");
  const specEntries = SPEC_LABELS.filter(([key]) => {
    const v = specs?.[key];
    return v !== undefined && v !== null && v !== "";
  });

  if (specEntries.length === 0 && attachments.length === 0) return null;

  return (
    <>
      {specEntries.length > 0 && (
        <section className="rounded-xl border border-[var(--border)] bg-surface-1 p-5">
          <h2 className="mb-3 text-[15px] font-semibold text-foreground">
            Specifications
          </h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            {specEntries.map(([key, label]) => (
              <div key={key}>
                <dt className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
                  {label}
                </dt>
                <dd className="text-sm capitalize text-[var(--text-secondary)]">
                  {specs?.[key]}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {assets.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold text-foreground">
            Attachments
          </h2>
          <ul className="flex flex-col gap-1.5">
            {assets.map((a) => (
              <AttachmentRow key={a.id} a={a} />
            ))}
          </ul>
        </section>
      )}

      {references.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold text-foreground">
            References
          </h2>
          <ul className="flex flex-col gap-1.5">
            {references.map((a) => (
              <AttachmentRow key={a.id} a={a} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
