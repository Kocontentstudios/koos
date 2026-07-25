import { notFound } from "next/navigation";
import { toBrandExport } from "@/lib/admin/brand-export";
import { requireRole } from "@/lib/auth/require-role";
import { getBrandForAdmin } from "@/lib/db/queries";
import { isUuid } from "@/lib/validation/uuid";

const SECTION_TITLES: Record<string, string> = {
  basics: "Basics",
  audience: "Audience & Offer",
  personality: "Brand Personality",
  visual: "Visual Identity",
  competitors: "Competitors",
  platforms: "Platforms & Posting",
  additional: "Anything Else",
};

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export default async function AdminBrandDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole(["admin"]);
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const row = await getBrandForAdmin(id);
  if (!row) notFound();

  const exported = toBrandExport(row.brand);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">
            {row.brand.name}
          </h1>
          <p className="mt-1 text-[14px] text-[var(--text-secondary)]">
            {row.ownerEmail} · {row.workspaceName} ·{" "}
            <span className="capitalize">{row.brand.onboardingStatus}</span> (
            {row.brand.completionPercentage}%)
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <a
            href={`/api/admin/brands/${row.brand.id}/export`}
            className="inline-flex h-9 items-center rounded-lg border border-[var(--border)] bg-surface-1 px-4 text-[13px] font-semibold text-foreground hover:border-[var(--border-accent)]"
          >
            Download JSON
          </a>
          {row.brand.logoUrl && (
            <a
              href={`/api/admin/brands/${row.brand.id}/logo`}
              className="inline-flex h-9 items-center rounded-lg border border-[var(--border)] bg-surface-1 px-4 text-[13px] font-semibold text-foreground hover:border-[var(--border-accent)]"
            >
              Download Logo
            </a>
          )}
        </div>
      </header>

      {row.brand.logoUrl && (
        <div className="rounded-xl border border-[var(--border)] bg-surface-1 p-5">
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Logo
          </h2>
          {/* biome-ignore lint/performance/noImgElement: arbitrary tenant-uploaded host, not a known next/image domain */}
          <img
            src={row.brand.logoUrl}
            alt={`${row.brand.name} logo`}
            className="max-h-32 w-auto"
          />
        </div>
      )}

      {Object.entries(exported.sections).map(([key, fields]) => (
        <section
          key={key}
          className="rounded-xl border border-[var(--border)] bg-surface-1 p-5"
        >
          <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {SECTION_TITLES[key] ?? key}
          </h2>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Object.entries(fields as Record<string, unknown>).map(
              ([field, value]) => (
                <div key={field}>
                  <dt className="text-[12px] text-[var(--text-muted)]">
                    {humanizeKey(field)}
                  </dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-[13px] text-foreground">
                    {renderValue(value)}
                  </dd>
                </div>
              ),
            )}
          </dl>
        </section>
      ))}
    </div>
  );
}
