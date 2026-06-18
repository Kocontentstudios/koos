import Link from "next/link";
import { requireBrand } from "@/lib/auth/require-brand";
import { getBrandsByUserId } from "@/lib/db/queries";

/* ------------------------------------------------------------------ */
/*  Material Symbol helper                                            */
/* ------------------------------------------------------------------ */
function Icon({
  name,
  filled = false,
  className = "",
}: {
  name: string;
  filled?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`material-symbols-outlined ${className}`}
      style={{
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' 400, 'GRAD' 0, 'opsz' 24`,
      }}
    >
      {name}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
const AVATAR_COLORS = [
  "bg-emerald-500/20 text-emerald-400",
  "bg-violet-500/20 text-violet-400",
  "bg-amber-500/20 text-amber-400",
  "bg-rose-500/20 text-rose-400",
  "bg-sky-500/20 text-sky-400",
  "bg-pink-500/20 text-pink-400",
];

function avatarColor(index: number) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 60) return "just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

function mapOnboardingStatus(status: "draft" | "in_progress" | "completed"): {
  label: string;
  style: string;
} {
  switch (status) {
    case "completed":
      return { label: "Active", style: "bg-emerald-500/15 text-emerald-400" };
    case "in_progress":
      return { label: "In Progress", style: "bg-amber-500/15 text-amber-400" };
    case "draft":
      return {
        label: "Draft",
        style: "bg-on-surface-variant/10 text-on-surface-variant",
      };
  }
}

const quickActions = [
  { label: "Edit Brand", icon: "add_business", href: "/brand" },
  { label: "Open Strategy", icon: "auto_awesome", href: "/strategy" },
];

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */
export default async function DashboardPage() {
  const { dbUser } = await requireBrand();

  const userBrands = await getBrandsByUserId(dbUser.id);

  const firstName = dbUser.firstName ?? "there";

  return (
    <div className="space-y-8">
      {/* ---- Hero ---- */}
      <section>
        <h1 className="font-heading text-4xl font-bold text-on-surface">
          Welcome back, <span className="gradient-text">{firstName}</span>.
        </h1>
        <p className="mt-2 max-w-xl text-on-surface-variant">
          Here&apos;s an overview of your brands. Let&apos;s build something
          remarkable today.
        </p>
      </section>

      {/* ---- 12-column Grid ---- */}
      <div className="grid grid-cols-12 gap-6">
        {/* ============================================================ */}
        {/*  LEFT COLUMN  col-span-8                                     */}
        {/* ============================================================ */}
        <div className="col-span-8 space-y-6">
          {/* ---- Recent Brands ---- */}
          <div className="glass-panel glow-hover p-6">
            <div className="mb-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Icon name="folder_shared" className="text-xl text-primary" />
                <h2 className="font-heading text-lg font-semibold text-on-surface">
                  Your Brands
                </h2>
              </div>
              <Link
                href="/brand"
                className="text-sm font-medium text-primary transition-colors hover:text-primary/80"
              >
                View Profile
              </Link>
            </div>

            {userBrands.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-outline-variant/50 py-12 text-center">
                <Icon
                  name="add_business"
                  className="mb-3 text-4xl text-on-surface-variant/50"
                />
                <p className="text-sm font-medium text-on-surface-variant">
                  No brands yet.
                </p>
                <p className="mt-1 text-xs text-on-surface-variant/70">
                  Create your first brand to get started.
                </p>
                <Link
                  href="/brand/create"
                  className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90"
                >
                  Create Brand
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {userBrands.map((brand, index) => {
                  const initials = brand.name
                    .split(/\s+/)
                    .map((w) => w[0])
                    .join("")
                    .toUpperCase()
                    .slice(0, 2);
                  const { label: statusLabel, style: statusStyle } =
                    mapOnboardingStatus(brand.onboardingStatus);

                  return (
                    <div
                      key={brand.id}
                      className="group rounded-xl border border-outline-variant/40 bg-surface-container-low/50 p-4 transition-all hover:border-primary/30 hover:bg-surface-container-high/40"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${avatarColor(index)}`}
                          >
                            {initials}
                          </div>
                          <div>
                            <p className="font-medium text-on-surface">
                              {brand.name}
                            </p>
                            <span className="inline-block mt-0.5 rounded-full bg-surface-container-high/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-on-surface-variant">
                              {brand.onboardingType}
                            </span>
                          </div>
                        </div>
                        <span className={`status-pill mt-1 ${statusStyle}`}>
                          {statusLabel}
                        </span>
                      </div>
                      <p className="mt-3 text-xs text-on-surface-variant">
                        Updated {formatRelativeTime(brand.updatedAt)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ============================================================ */}
        {/*  RIGHT COLUMN  col-span-4                                    */}
        {/* ============================================================ */}
        <div className="col-span-4 space-y-6">
          {/* ---- AI Insight Widget ---- */}
          <div className="glass-panel glow-hover border-primary/30 p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 ai-glow">
                <Icon
                  name="auto_awesome"
                  filled
                  className="text-xl text-primary"
                />
              </div>
              <div>
                <h3 className="font-heading text-sm font-semibold text-primary">
                  AI Insight
                </h3>
                <p className="text-xs text-on-surface-variant">Powered by AI</p>
              </div>
            </div>
            <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
              {userBrands.length > 0
                ? `Your "${userBrands[0].name}" brand is ready for action. Use Strategy to get insights and drive growth.`
                : "Create your first brand to unlock AI-powered insights and recommendations."}
            </p>
            <Link
              href="/strategy"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-[#0a6d9e] px-4 py-2.5 text-sm font-semibold text-white transition-all hover:shadow-lg hover:shadow-primary/25"
            >
              <Icon name="edit_note" className="text-lg" />
              Open Strategy
            </Link>
          </div>

          {/* ---- Quick Actions ---- */}
          <div className="glass-panel glow-hover p-6">
            <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant">
              Quick Actions
            </h3>
            <div className="space-y-1">
              {quickActions.map((action) => (
                <Link
                  key={action.label}
                  href={action.href}
                  className="group flex items-center justify-between rounded-lg px-3 py-3 transition-colors hover:bg-surface-container-high/60"
                >
                  <div className="flex items-center gap-3">
                    <Icon
                      name={action.icon}
                      className="text-xl text-on-surface-variant group-hover:text-primary"
                    />
                    <span className="text-sm font-medium text-on-surface">
                      {action.label}
                    </span>
                  </div>
                  <Icon
                    name="chevron_right"
                    className="text-lg text-on-surface-variant opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
