import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { getAuthUser } from "@/lib/auth/get-user";
import { hasCompletedBrand } from "@/lib/brand-profile";
import { getActiveBrandForUser } from "@/lib/db/queries";

/* ------------------------------------------------------------------ */
/*  Label helpers                                                      */
/* ------------------------------------------------------------------ */

function labelBusinessType(value: string): string {
  const map: Record<string, string> = {
    ecommerce: "E-Commerce",
    saas: "SaaS",
    agency: "Agency",
    creator: "Creator / Personal Brand",
    nonprofit: "Non-Profit",
    local: "Local Business",
    other: "Other",
  };
  return map[value] ?? value;
}

function labelStage(value: string): string {
  const map: Record<string, string> = {
    idea: "Idea Stage",
    pre_launch: "Pre-Launch",
    early: "Early Stage",
    growth: "Growth",
    scale: "Scale",
  };
  return map[value] ?? value;
}

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
      <dd className="text-sm text-[var(--text-secondary)] leading-relaxed">
        {value}
      </dd>
    </div>
  );
}

function ColorSwatch({ hex }: { hex: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-6 w-6 rounded border border-[var(--border)]"
        style={{ backgroundColor: hex }}
      />
      <span className="text-xs font-mono text-[var(--text-secondary)]">
        {hex}
      </span>
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

  return (
    <div className="space-y-8 max-w-[720px]">
      {/* ---- Header ---- */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold text-foreground">
            {brand.name}
          </h1>
          <StatusBadge status="ready">
            {brand.onboardingStatus === "completed"
              ? "Active"
              : brand.onboardingStatus}
          </StatusBadge>
        </div>

        {/* Note: Edit links to /brand/create; pre-fill support is deferred to a future phase. */}
        <Link href="/brand/create">
          <Button variant="secondary" size="lg">
            Edit profile
          </Button>
        </Link>
      </div>

      {/* ---- Logo ---- */}
      {brand.logoUrl && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            Logo
          </p>
          <Image
            src={brand.logoUrl}
            alt={`${brand.name} logo`}
            width={128}
            height={64}
            className="h-16 w-auto rounded object-contain"
            unoptimized
          />
        </div>
      )}

      {/* ---- Profile Fields ---- */}
      <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 rounded-xl border border-[var(--border)] bg-surface-1 p-6">
        <Section label="Overview" value={brand.overview} />
        <Section
          label="Business Type"
          value={
            brand.businessType ? labelBusinessType(brand.businessType) : null
          }
        />
        <Section
          label="Stage"
          value={brand.stage ? labelStage(brand.stage) : null}
        />
        <Section label="Target Audience" value={brand.targetAudience} />
        <Section label="Offer" value={brand.offer} />
        <Section label="Tone" value={brand.tone} />
        <Section label="Primary Goal" value={brand.primaryGoal} />
      </dl>

      {/* ---- Brand Colors ---- */}
      {(brand.primaryColor ||
        brand.secondaryColor ||
        additionalColors.length > 0) && (
        <div className="rounded-xl border border-[var(--border)] bg-surface-1 p-6 space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">
            Brand Colors
          </p>
          <div className="space-y-3">
            {brand.primaryColor && (
              <div className="space-y-1">
                <p className="text-xs text-[var(--text-muted)]">Primary</p>
                <ColorSwatch hex={brand.primaryColor} />
              </div>
            )}
            {brand.secondaryColor && (
              <div className="space-y-1">
                <p className="text-xs text-[var(--text-muted)]">Secondary</p>
                <ColorSwatch hex={brand.secondaryColor} />
              </div>
            )}
            {additionalColors.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-[var(--text-muted)]">Additional</p>
                <div className="flex flex-wrap gap-3">
                  {additionalColors.map((hex) => (
                    <ColorSwatch key={hex} hex={hex} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
