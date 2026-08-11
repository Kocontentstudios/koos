import { Download, Eye, FileArchive, Lock } from "lucide-react";
import type { DeliverableVersionGroup } from "@/lib/design/ticket";
import { cn } from "@/lib/utils";

export type VersionedDeliverable = {
  id: string;
  fileName: string;
  version: number;
  createdAt: Date;
};

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

function formatDeliveredAt(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Delivery rounds, newest first, so the client keeps an audit trail across
 * revisions. Every round is previewable; downloading waits on approval. */
export function DeliverableVersions({
  ticketId,
  groups,
  canDownload,
}: {
  ticketId: string;
  groups: DeliverableVersionGroup<VersionedDeliverable>[];
  canDownload: boolean;
}) {
  if (groups.length === 0) return null;
  const latestVersion = groups[0].version;

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-semibold text-foreground">
        Deliverables
      </h2>

      {!canDownload && (
        <p className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-surface-2 px-4 py-3 text-[13px] text-[var(--text-secondary)]">
          <Lock
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <span>
            Preview any version full-size below. Downloads unlock as soon as you
            mark the design{" "}
            <strong className="text-foreground">Satisfied</strong>.
          </span>
        </p>
      )}

      {groups.map((group) => {
        const isLatest = group.version === latestVersion;
        return (
          <div
            key={group.version}
            className={cn(
              "space-y-3 rounded-xl border bg-surface-1 p-4",
              isLatest
                ? "border-[var(--border-accent)]"
                : "border-[var(--border)]",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-foreground">
                  V{group.version}
                </span>
                <span className="text-[13px] text-[var(--text-muted)]">
                  {formatDeliveredAt(group.deliveredAt)}
                </span>
                {isLatest && groups.length > 1 && (
                  <span className="rounded-full border border-[var(--border-accent)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
                    Latest
                  </span>
                )}
              </div>
              {canDownload ? (
                <a
                  href={`/api/design-tickets/${ticketId}/deliverables/zip?version=${group.version}`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  <FileArchive className="h-4 w-4" aria-hidden="true" />
                  Download all (ZIP)
                </a>
              ) : (
                <span
                  title="Mark the design Satisfied to download"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-3 py-1.5 text-[13px] font-medium text-[var(--text-muted)]"
                >
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  Download all (ZIP)
                </span>
              )}
            </div>

            <ul className="grid gap-3 sm:grid-cols-2">
              {group.items.map((d) => {
                const previewHref = `/api/design-tickets/${ticketId}/deliverables/${d.id}?disposition=inline`;
                return (
                  <li
                    key={d.id}
                    className="overflow-hidden rounded-xl border border-[var(--border)] bg-surface-2"
                  >
                    {IMAGE_RE.test(d.fileName) && (
                      // biome-ignore lint/performance/noImgElement: src is a redirecting download route, not optimizable by next/image
                      <img
                        src={previewHref}
                        alt={`${d.fileName} (version ${d.version})`}
                        className="h-40 w-full bg-surface-1 object-contain"
                      />
                    )}
                    <div className="flex items-center justify-between gap-2 p-3">
                      <a
                        href={previewHref}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-[13px] text-[var(--text-secondary)] hover:text-primary hover:underline"
                      >
                        {d.fileName}
                      </a>
                      {canDownload ? (
                        <a
                          href={`/api/design-tickets/${ticketId}/deliverables/${d.id}?disposition=attachment`}
                          download
                          className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-primary hover:underline"
                        >
                          <Download
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          Download
                        </a>
                      ) : (
                        <a
                          href={previewHref}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-[var(--text-secondary)] hover:text-primary hover:underline"
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          View
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
