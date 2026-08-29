import { Check } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  identityLine,
  paletteSwatches,
  toneBadges,
} from "@/lib/brand-snapshot";
import { cn } from "@/lib/utils";

export interface BrandSnapshot {
  name: string;
  logoUrl?: string | null;
  overview?: string | null;
  businessType?: string | null;
  stage?: string | null;
  targetAudience?: string | null;
  tone?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  additionalColors?: string[] | null;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
      {children}
    </h3>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <SectionLabel>{label}</SectionLabel>
      {children}
    </section>
  );
}

/**
 * The hand-off shown the moment brand setup finishes, before the dashboard.
 *
 * Everything here is conditional: the conversational path cannot set a logo at
 * all (logoUrl is not among the fields the model may write), and every section
 * below Basics is optional in the form, so a brand that answered only the
 * required questions still has to render as a complete card rather than a run
 * of empty headings.
 */
export function BrandSnapshotCard({
  brand,
  profileHref = "/brand",
  dashboardHref = "/dashboard",
}: {
  brand: BrandSnapshot;
  profileHref?: string;
  dashboardHref?: string;
}) {
  const identity = identityLine(brand.businessType, brand.stage);
  const badges = toneBadges(brand.tone);
  const swatches = paletteSwatches(brand);
  const tone = brand.tone?.trim();

  return (
    <div className="mx-auto w-full max-w-[680px] py-8 sm:py-16">
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-gradient-to-b from-[var(--surface-2)] to-[var(--surface-1)] p-6 sm:p-10">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-primary">
          <Check aria-hidden="true" className="size-3.5" />
          Brand Setup Complete!
        </p>
        <h1 className="mt-3 font-display text-[28px] font-bold leading-tight text-foreground sm:text-[36px]">
          Brand Snapshot
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-secondary)]">
          Your brand setup is complete. Here is a quick snapshot of your brand
          intelligence powered by KO OS.
        </p>

        <hr className="my-7 border-0 border-t border-[var(--divider)]" />

        <div className="space-y-7">
          <Section label="Brand identity">
            <div className="flex items-center gap-4">
              <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[var(--border)] bg-surface-2">
                {brand.logoUrl ? (
                  <Image
                    src={brand.logoUrl}
                    alt={`${brand.name} logo`}
                    width={64}
                    height={64}
                    className="h-full w-full object-contain"
                    unoptimized
                  />
                ) : (
                  <span className="text-2xl font-semibold text-[var(--text-muted)]">
                    {brand.name.trim()[0]?.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="min-w-0 space-y-2">
                <h2 className="truncate text-[24px] font-bold leading-tight text-foreground">
                  {brand.name}
                </h2>
                {identity && (
                  <span className="inline-block rounded-full border border-[var(--border-accent)] px-3 py-1 text-[13px] text-[var(--text-secondary)]">
                    {identity}
                  </span>
                )}
              </div>
            </div>
          </Section>

          {brand.overview?.trim() && (
            <Section label="One-line overview">
              <p className="text-[15px] italic leading-relaxed text-[var(--text-secondary)]">
                “{brand.overview.trim()}”
              </p>
            </Section>
          )}

          {brand.targetAudience?.trim() && (
            <Section label="Target audience">
              <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
                {brand.targetAudience.trim()}
              </p>
            </Section>
          )}

          {tone && (
            <Section label="Brand voice & tone">
              {badges.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {badges.map((badge) => (
                    <li
                      key={badge}
                      className="rounded-full border border-[var(--border-accent)] bg-surface-2 px-4 py-2 text-[13px] font-medium text-foreground"
                    >
                      {badge}
                    </li>
                  ))}
                </ul>
              ) : (
                /* A tone written as a sentence rather than a list — shown as
                   what the user actually said instead of one card-wide pill. */
                <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">
                  {tone}
                </p>
              )}
            </Section>
          )}

          {swatches.length > 0 && (
            <Section label="Visual palette">
              <ul className="flex flex-wrap gap-x-6 gap-y-3">
                {swatches.map((swatch) => (
                  <li
                    key={swatch.value}
                    className="flex items-center gap-2.5 text-[14px] text-[var(--text-secondary)]"
                  >
                    {swatch.hex ? (
                      <span
                        aria-hidden="true"
                        className="size-7 shrink-0 rounded-full border border-[var(--border)]"
                        style={{ backgroundColor: swatch.hex }}
                      />
                    ) : null}
                    {swatch.hex ?? swatch.value}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        {/* Secondary first, matching the design: the dashboard is the default
            next step, so it sits where the eye lands last on desktop and
            closest to the thumb on mobile.

            Links styled with buttonVariants rather than Buttons: these
            navigate, so they must announce as links. Wrapping a Button in a
            Link nests interactive content, and Base UI's render prop stamps
            role="button" onto the anchor. */}
        <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:justify-between">
          <Link
            href={profileHref}
            className={cn(
              buttonVariants({ variant: "secondary", size: "lg" }),
              "h-12 w-full px-6 text-[15px] sm:w-auto",
            )}
          >
            View Full Brand Profile
          </Link>
          <Link
            href={dashboardHref}
            className={cn(
              buttonVariants({ variant: "default", size: "lg" }),
              "h-12 w-full px-8 text-[15px] sm:w-auto",
            )}
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
