import Link from "next/link";
import { cn } from "@/lib/utils";

export interface RecordRow {
  key: string;
  /** Where the row opens, when there is somewhere to go. */
  href?: string;
  cells: string[];
}

export interface RecordsTableProps {
  columns: string[];
  rows: RecordRow[];
  total: number;
  empty: string;
  page: number;
  pages: number;
  prevHref: string | null;
  nextHref: string | null;
}

/**
 * The rows behind one analytics number.
 *
 * A server component: nothing here is interactive beyond links, so it needs no
 * client bundle. Columns vary per metric, so they arrive as data rather than
 * five near-identical tables.
 */
export function RecordsTable({
  columns,
  rows,
  total,
  empty,
  page,
  pages,
  prevHref,
  nextHref,
}: RecordsTableProps) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] text-[var(--text-secondary)] tabular-nums">
        {total} {total === 1 ? "record" : "records"}
      </p>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-surface-1 px-6 py-12 text-center text-[14px] text-[var(--text-secondary)]">
          {empty}
        </p>
      ) : (
        /* Wide content scrolls in its own container so the page body never
           scrolls sideways. */
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-surface-1">
          <table className="w-full min-w-[44rem] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[12px] uppercase tracking-wide text-[var(--text-secondary)]">
                {columns.map((c) => (
                  <th key={c} className="px-4 py-3 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className="border-t border-[var(--border)] text-foreground"
                >
                  {row.cells.map((cell, i) => (
                    <td
                      key={`${row.key}-${columns[i] ?? i}`}
                      className={cn(
                        "px-4 py-3",
                        i === 0
                          ? "whitespace-nowrap"
                          : "text-[var(--text-secondary)]",
                      )}
                    >
                      {/* Only the first cell links: a row-wide link would
                          swallow the text selection an operator needs to copy
                          an email or a ticket number out of the others. */}
                      {i === 0 && row.href ? (
                        <Link
                          href={row.href}
                          className="font-medium text-primary hover:underline"
                        >
                          {cell}
                        </Link>
                      ) : (
                        cell
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(pages > 1 || page > pages) && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between gap-3"
        >
          <PagerLink href={prevHref}>← Previous</PagerLink>
          <span className="text-[12px] text-[var(--text-secondary)] tabular-nums">
            Page {page} of {pages}
          </span>
          <PagerLink href={nextHref}>Next →</PagerLink>
        </nav>
      )}
    </div>
  );
}

function PagerLink({
  href,
  children,
}: {
  href: string | null;
  children: React.ReactNode;
}) {
  const className =
    "inline-flex h-9 items-center rounded-[10px] border border-[var(--border)] px-3 text-[13px] font-semibold";
  if (!href) {
    return (
      <span aria-disabled="true" className={cn(className, "opacity-40")}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={cn(className, "hover:bg-[var(--hover)]")}>
      {children}
    </Link>
  );
}
