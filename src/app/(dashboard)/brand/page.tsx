import { Fragment } from "react";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAuthUser } from "@/lib/auth/get-user";
import { hasCompletedBrand } from "@/lib/brand-profile";
import { getActiveBrandForUser } from "@/lib/db/queries";

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

/** A single divider-separated row inside the profile body. */
function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 text-[12px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
      <div className="text-[15px] leading-relaxed text-foreground">
        {children}
      </div>
    </div>
  );
}

/** Secondary "key: value" line used inside richer sections. */
function DetailLine({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <p className="text-[13px] text-[var(--text-secondary)]">
      <span className="font-semibold text-foreground">{label}:</span> {children}
    </p>
  );
}

function ColorSwatch({ hex, label }: { hex: string; label?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="h-9 w-9 shrink-0 rounded-full border-2 border-[var(--border)]"
        style={{ backgroundColor: hex }}
      />
      <div className="leading-tight">
        {label && (
          <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
        )}
        <div className="font-mono text-[13px] font-medium text-foreground">
          {hex}
        </div>
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

  const hasColors = Boolean(
    brand.primaryColor || brand.secondaryColor || additionalColors.length > 0,
  );
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

  /* Build the body as an ordered list of sections so we can interleave
     dividers only between the ones that actually render (matching
     koos_complete/brands.html). */
  const sections: { key: string; node: React.ReactNode }[] = [];

  if (brand.targetAudience) {
    sections.push({
      key: "audience",
      node: <FieldRow label="Target Audience">{brand.targetAudience}</FieldRow>,
    });
  }
  if (brand.offer) {
    sections.push({
      key: "offer",
      node: <FieldRow label="Offer">{brand.offer}</FieldRow>,
    });
  }
  if (brand.tone) {
    sections.push({
      key: "tone",
      node: <FieldRow label="Tone of Voice">{brand.tone}</FieldRow>,
    });
  }
  if (brand.primaryGoal) {
    sections.push({
      key: "goal",
      node: <FieldRow label="Primary Goal">{brand.primaryGoal}</FieldRow>,
    });
  }
  if (hasColors) {
    sections.push({
      key: "colors",
      node: (
        <FieldRow label="Brand Colors">
          <div className="flex flex-wrap gap-x-8 gap-y-4">
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
        </FieldRow>
      ),
    });
  }
  if (hasPersonality) {
    sections.push({
      key: "personality",
      node: (
        <FieldRow label="Brand Personality">
          <div className="space-y-2">
            {brand.values && <p>{brand.values}</p>}
            {brand.wordsLove && (
              <DetailLine label="Words we love">{brand.wordsLove}</DetailLine>
            )}
            {brand.wordsAvoid && (
              <DetailLine label="Words to avoid">{brand.wordsAvoid}</DetailLine>
            )}
          </div>
        </FieldRow>
      ),
    });
  }
  if (hasVisual) {
    sections.push({
      key: "visual",
      node: (
        <FieldRow label="Visual Identity">
          <div className="space-y-1.5">
            {brand.hasLogo != null && (
              <DetailLine label="Has logo">
                {brand.hasLogo ? "Yes" : "No"}
              </DetailLine>
            )}
            {brand.brandStyle && (
              <DetailLine label="Brand style">{brand.brandStyle}</DetailLine>
            )}
          </div>
        </FieldRow>
      ),
    });
  }
  if (hasCompetitors) {
    sections.push({
      key: "competitors",
      node: (
        <FieldRow label="Competitors">
          <div className="space-y-2">
            {brand.competitors && <p>{brand.competitors}</p>}
            {brand.competitorStrengths && (
              <DetailLine label="What they do well">
                {brand.competitorStrengths}
              </DetailLine>
            )}
            {brand.differentiators && (
              <DetailLine label="How we're different">
                {brand.differentiators}
              </DetailLine>
            )}
          </div>
        </FieldRow>
      ),
    });
  }
  if (hasPlatforms) {
    sections.push({
      key: "platforms",
      node: (
        <FieldRow label="Platforms & Posting">
          <div className="space-y-3">
            {platforms.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {platforms.map((p) => (
                  <span
                    key={p}
                    className="rounded-full bg-[rgba(19,139,200,0.12)] px-2.5 py-1 text-xs font-medium text-primary"
                  >
                    {p}
                  </span>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              {brand.primaryPlatform && (
                <DetailLine label="Primary platform">
                  {brand.primaryPlatform}
                </DetailLine>
              )}
              {brand.postingFrequency && (
                <DetailLine label="Posting frequency">
                  {brand.postingFrequency}
                </DetailLine>
              )}
            </div>
          </div>
        </FieldRow>
      ),
    });
  }
  if (hasNotes) {
    sections.push({
      key: "notes",
      node: (
        <FieldRow label="Anything Else">
          <div className="space-y-2">
            {brand.additionalNotes && (
              <p className="whitespace-pre-line">{brand.additionalNotes}</p>
            )}
            {brand.helpfulLinks && (
              <DetailLine label="Helpful links">{brand.helpfulLinks}</DetailLine>
            )}
          </div>
        </FieldRow>
      ),
    });
  }

  return (
    <div className="space-y-6">
      {/* ---- Page header ---- */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground">
            Brand Profile
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Your brand information used for AI strategies and design assets
          </p>
        </div>
        <Link href="/brand/create" className="shrink-0">
          <Button variant="secondary" size="lg">
            <PencilIcon aria-hidden="true" />
            Edit Brand
          </Button>
        </Link>
      </div>

      {/* ---- Unified brand profile card ---- */}
      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-surface-1">
        {/* Header band — blue in light mode, navy in dark */}
        <div className="brand-header-band flex flex-col items-center gap-5 p-6 text-center sm:flex-row sm:items-center sm:gap-6 sm:p-8 sm:text-left">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-[var(--border)] bg-surface-2">
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
              <span className="text-3xl font-semibold text-[var(--text-muted)]">
                {brand.name[0]?.toUpperCase()}
              </span>
            )}
          </div>
          <div className="brand-header-info space-y-2">
            <h2 className="text-2xl font-bold text-foreground">{brand.name}</h2>
            {brand.overview && (
              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                {brand.overview}
              </p>
            )}
            {(brand.businessType || brand.stage) && (
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1 sm:justify-start">
                {brand.businessType && (
                  <span className="brand-badge brand-badge-blue">
                    {brand.businessType}
                  </span>
                )}
                {brand.stage && (
                  <span className="brand-badge brand-badge-gray">
                    {brand.stage}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Body — divider-separated rows */}
        {sections.length > 0 && (
          <div className="p-6 sm:p-8">
            {sections.map((section, i) => (
              <Fragment key={section.key}>
                {i > 0 && <div className="my-6 h-px bg-[var(--divider)]" />}
                {section.node}
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
