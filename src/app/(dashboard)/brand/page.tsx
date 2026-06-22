import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { getAuthUser } from "@/lib/auth/get-user";
import { hasCompletedBrand } from "@/lib/brand-profile";
import { getActiveBrandForUser } from "@/lib/db/queries";

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function Section({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div className="space-y-1">
      <dt className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-line">
        {value}
      </dd>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-surface-1 p-6 space-y-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
        {title}
      </p>
      {children}
    </div>
  );
}

function ColorSwatch({ hex, label }: { hex: string; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-8 w-8 rounded-full border border-[var(--border)]"
        style={{ backgroundColor: hex }}
      />
      <div>
        {label && <p className="text-xs text-[var(--text-muted)]">{label}</p>}
        <span className="text-xs font-mono text-[var(--text-secondary)]">
          {hex}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default async function BrandProfilePage() {
  const { dbUser } = await getAuthUser();
  if (!dbUser) redirect("/login");

  const brand = await getActiveBrandForUser(dbUser.id);
  if (!brand || !hasCompletedBrand(brand.onboardingStatus)) {
    redirect("/brand/create");
  }

  const additionalColors = brand.additionalColors ?? [];
  const platforms = brand.platforms ?? [];

  const hasPersonality = Boolean(
    brand.values || brand.wordsLove || brand.wordsAvoid,
  );
  const hasVisual = Boolean(brand.hasLogo != null || brand.brandStyle);
  const hasCompetitors = Boolean(
    brand.competitors || brand.competitorStrengths || brand.differentiators,
  );
  const hasPlatforms = Boolean(
    platforms.length || brand.primaryPlatform || brand.postingFrequency,
  );
  const hasNotes = Boolean(brand.additionalNotes || brand.helpfulLinks);

  return (
    <div className="space-y-6 max-w-[760px]">
      {/* ---- Header ---- */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground">
            Brand Profile
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Your brand information used for AI strategies and design assets
          </p>
        </div>
        <Link href="/brand/create">
          <Button variant="secondary" size="lg">
            Edit Brand
          </Button>
        </Link>
      </div>

      {/* ---- Brand header card ---- */}
      <div className="flex items-start gap-5 rounded-xl border border-[var(--border)] bg-surface-1 p-6">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-container-low)]">
          {brand.logoUrl ? (
            <Image
              src={brand.logoUrl}
              alt={`${brand.name} logo`}
              width={80}
              height={80}
              className="h-full w-full object-contain"
              unoptimized
            />
          ) : (
            <span className="text-2xl text-[var(--text-muted)]">
              {brand.name[0]?.toUpperCase()}
            </span>
          )}
        </div>
        <div className="space-y-2">
          <h2 className="text-xl font-bold text-foreground">{brand.name}</h2>
          {brand.overview && (
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              {brand.overview}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {brand.businessType && (
              <StatusBadge status="in_progress">
                {brand.businessType}
              </StatusBadge>
            )}
            {brand.stage && (
              <StatusBadge status="draft">{brand.stage}</StatusBadge>
            )}
          </div>
        </div>
      </div>

      {/* ---- Direction ---- */}
      <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 rounded-xl border border-[var(--border)] bg-surface-1 p-6">
        <Section label="Target Audience" value={brand.targetAudience} />
        <Section label="Offer" value={brand.offer} />
        <Section label="Tone of Voice" value={brand.tone} />
        <Section label="Primary Goal" value={brand.primaryGoal} />
      </dl>

      {/* ---- Brand Colors ---- */}
      {(brand.primaryColor ||
        brand.secondaryColor ||
        additionalColors.length > 0) && (
        <Panel title="Brand Colors">
          <div className="flex flex-wrap gap-6">
            {brand.primaryColor && (
              <ColorSwatch hex={brand.primaryColor} label="Primary" />
            )}
            {brand.secondaryColor && (
              <ColorSwatch hex={brand.secondaryColor} label="Secondary" />
            )}
            {additionalColors.map((hex) => (
              <ColorSwatch key={hex} hex={hex} />
            ))}
          </div>
        </Panel>
      )}

      {/* ---- Brand Personality ---- */}
      {hasPersonality && (
        <Panel title="Brand Personality">
          <div className="space-y-3 text-sm text-[var(--text-secondary)]">
            {brand.values && <p>{brand.values}</p>}
            {brand.wordsLove && (
              <p>
                <span className="font-semibold text-foreground">
                  Words we love:
                </span>{" "}
                {brand.wordsLove}
              </p>
            )}
            {brand.wordsAvoid && (
              <p>
                <span className="font-semibold text-foreground">
                  Words to avoid:
                </span>{" "}
                {brand.wordsAvoid}
              </p>
            )}
          </div>
        </Panel>
      )}

      {/* ---- Visual Identity ---- */}
      {hasVisual && (
        <Panel title="Visual Identity">
          <div className="space-y-2 text-sm text-[var(--text-secondary)]">
            {brand.hasLogo != null && (
              <p>
                <span className="font-semibold text-foreground">Has logo:</span>{" "}
                {brand.hasLogo ? "Yes" : "No"}
              </p>
            )}
            {brand.brandStyle && (
              <p>
                <span className="font-semibold text-foreground">
                  Brand style:
                </span>{" "}
                {brand.brandStyle}
              </p>
            )}
          </div>
        </Panel>
      )}

      {/* ---- Competitors ---- */}
      {hasCompetitors && (
        <Panel title="Competitors">
          <div className="space-y-3 text-sm text-[var(--text-secondary)]">
            {brand.competitors && <p>{brand.competitors}</p>}
            {brand.competitorStrengths && (
              <p>
                <span className="font-semibold text-foreground">
                  What they do well:
                </span>{" "}
                {brand.competitorStrengths}
              </p>
            )}
            {brand.differentiators && (
              <p>
                <span className="font-semibold text-foreground">
                  How we&apos;re different:
                </span>{" "}
                {brand.differentiators}
              </p>
            )}
          </div>
        </Panel>
      )}

      {/* ---- Platforms & Posting ---- */}
      {hasPlatforms && (
        <Panel title="Platforms & Posting">
          {platforms.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {platforms.map((p) => (
                <span
                  key={p}
                  className="rounded-full border border-border bg-[var(--surface-container-low)] px-3 py-1 text-[13px] text-text-secondary"
                >
                  {p}
                </span>
              ))}
            </div>
          )}
          <div className="space-y-2 text-sm text-[var(--text-secondary)]">
            {brand.primaryPlatform && (
              <p>
                <span className="font-semibold text-foreground">
                  Primary platform:
                </span>{" "}
                {brand.primaryPlatform}
              </p>
            )}
            {brand.postingFrequency && (
              <p>
                <span className="font-semibold text-foreground">
                  Posting frequency:
                </span>{" "}
                {brand.postingFrequency}
              </p>
            )}
          </div>
        </Panel>
      )}

      {/* ---- Anything Else ---- */}
      {hasNotes && (
        <Panel title="Anything Else">
          <div className="space-y-3 text-sm text-[var(--text-secondary)]">
            {brand.additionalNotes && (
              <p className="whitespace-pre-line">{brand.additionalNotes}</p>
            )}
            {brand.helpfulLinks && (
              <p>
                <span className="font-semibold text-foreground">
                  Helpful links:
                </span>{" "}
                {brand.helpfulLinks}
              </p>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
