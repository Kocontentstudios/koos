import { AnnotationOverlay } from "@/components/design/annotation-overlay";
import type { AnnotationShape } from "@/lib/db/queries";
import { groupDeliverablesByVersion } from "@/lib/design/ticket";

interface AnnotationRow {
  deliverableId: string;
  shapes: AnnotationShape[];
  note: string | null;
}

interface DeliverableRow {
  id: string;
  fileName: string;
  version: number;
  createdAt: Date;
}

interface AnnotationRoundsProps {
  ticketId: string;
  deliverables: DeliverableRow[];
  annotations: AnnotationRow[];
  currentVersion: number | null;
  /** "Reviewer annotations" for staff, "Your markup" for the client. */
  title: string;
}

/**
 * Marked-up deliverables, grouped per delivery round.
 *
 * Shared by the admin queue and the client's own request page so both sides
 * read the same feedback. Rounds other than the current one are collapsed and
 * labelled, so addressed feedback doesn't sit next to live feedback looking
 * equally outstanding.
 *
 * Renders nothing when no deliverable in any round carries a mark.
 */
export function AnnotationRounds({
  ticketId,
  deliverables,
  annotations,
  currentVersion,
  title,
}: AnnotationRoundsProps) {
  const byDeliverable = new Map<string, AnnotationRow[]>();
  for (const row of annotations) {
    const existing = byDeliverable.get(row.deliverableId) ?? [];
    existing.push(row);
    byDeliverable.set(row.deliverableId, existing);
  }

  const rounds = groupDeliverablesByVersion(
    deliverables.filter((d) => byDeliverable.has(d.id)),
  );
  if (rounds.length === 0) return null;

  return (
    <section className="space-y-4">
      <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
      {rounds.map((round) => {
        const addressed = round.version !== currentVersion;
        const files = round.items.map((d) => {
          const marks = byDeliverable.get(d.id) ?? [];
          return {
            id: d.id,
            fileName: d.fileName,
            shapes: marks.flatMap((m) => m.shapes),
            notes: marks
              .map((m) => m.note)
              .filter((note): note is string => Boolean(note?.trim())),
          };
        });
        return (
          <details
            key={round.version}
            open={!addressed}
            className="rounded-xl border border-[var(--border)] bg-surface-1 p-4"
          >
            <summary className="cursor-pointer text-[13px] font-semibold text-foreground">
              Round {round.version} feedback
              {addressed && (
                <span className="ml-2 font-normal text-[var(--text-muted)]">
                  — addressed in v{currentVersion}
                </span>
              )}
            </summary>
            <div className="mt-3 space-y-4">
              {files.map((f) => (
                <div key={f.id} className="space-y-2">
                  <p className="text-[13px] font-medium text-[var(--text-secondary)]">
                    {f.fileName}
                  </p>
                  <AnnotationOverlay
                    imageUrl={`/api/design-tickets/${ticketId}/deliverables/${f.id}?disposition=inline`}
                    shapes={f.shapes}
                  />
                  {f.notes.length > 0 && (
                    <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--text-secondary)]">
                      {f.notes.map((note, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: notes are a static, read-only snapshot with no stable id
                        <li key={index}>{note}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </details>
        );
      })}
    </section>
  );
}
