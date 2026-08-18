import { StatCard } from "@/app/admin/stat-card";
import {
  bucketByPeriod,
  formatDuration,
  median,
  percentChange,
  splitCurrentAndPrevious,
  toBarPercentages,
} from "@/lib/analytics/rollup";
import { requireRole } from "@/lib/auth/require-role";
import {
  getActiveBrandCount,
  getApprovalDurationsSince,
  getSignupsSince,
  getTicketsSince,
  getTopBrandsByActivity,
  getUsageEventsSince,
} from "@/lib/db/queries";

const DAY_MS = 86_400_000;
const TREND_WEEKS = 12;

const KIND_LABELS: Record<string, string> = {
  strategy_generated: "Strategy",
  calendar_generated: "Calendar",
  design_ticket_created: "Design ticket",
  design_generated: "Design image",
};

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
        {subtitle && (
          <p className="text-[13px] text-[var(--text-muted)]">{subtitle}</p>
        )}
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-surface-1 p-4">
        {children}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-2 text-[13px] text-[var(--text-secondary)]">{children}</p>
  );
}

function BarRow({
  label,
  count,
  percent,
}: {
  label: string;
  count: number;
  percent: number;
}) {
  return (
    <li className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-[13px] text-[var(--text-secondary)]">
        {label}
      </span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="w-10 shrink-0 text-right text-[13px] font-medium text-foreground">
        {count}
      </span>
    </li>
  );
}

export default async function AdminAnalyticsPage() {
  await requireRole(["admin"]);

  const now = new Date();
  const trendStart = new Date(now.getTime() - TREND_WEEKS * 7 * DAY_MS);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * DAY_MS);

  const [usage, signups, tickets, activeBrands, topBrands, approvalMs] =
    await Promise.all([
      getUsageEventsSince(trendStart),
      getSignupsSince(fourteenDaysAgo),
      getTicketsSince(fourteenDaysAgo),
      getActiveBrandCount(thirtyDaysAgo),
      getTopBrandsByActivity(thirtyDaysAgo),
      getApprovalDurationsSince(trendStart),
    ]);

  const usageTimes = usage.map((e) => e.createdAt);
  const generations = splitCurrentAndPrevious(usageTimes, {
    now,
    periodDays: 7,
  });
  const newUsers = splitCurrentAndPrevious(
    signups.map((s) => s.createdAt),
    { now, periodDays: 7 },
  );
  const newTickets = splitCurrentAndPrevious(
    tickets.map((t) => t.createdAt),
    { now, periodDays: 7 },
  );

  const trend = bucketByPeriod(usageTimes, {
    now,
    periodDays: 7,
    periods: TREND_WEEKS,
  });
  const trendPercents = toBarPercentages(trend.map((b) => b.count));

  const byKind = Object.entries(
    usage.reduce<Record<string, number>>((acc, e) => {
      acc[e.kind] = (acc[e.kind] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const kindPercents = toBarPercentages(byKind.map(([, n]) => n));

  const brandPercents = toBarPercentages(topBrands.map((b) => b.count));

  return (
    <div className="flex flex-col gap-8">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-foreground">
          Analytics
        </h1>
        <p className="text-[14px] text-[var(--text-secondary)]">
          Product activity from the application database. Behavioural data
          (funnels, retention, session replay) lives in PostHog.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Generations"
          value={generations.current}
          change={percentChange(generations.current, generations.previous)}
          caption="last 7 days"
        />
        <StatCard
          label="Active brands"
          value={activeBrands}
          caption="last 30 days"
        />
        <StatCard
          label="New users"
          value={newUsers.current}
          change={percentChange(newUsers.current, newUsers.previous)}
          caption="last 7 days"
        />
        <StatCard
          label="Tickets"
          value={newTickets.current}
          change={percentChange(newTickets.current, newTickets.previous)}
          caption="last 7 days"
        />
        <StatCard
          label="Time to approval"
          value={formatDuration(median(approvalMs))}
          caption={`median of ${approvalMs.length} approved`}
        />
      </section>

      <Panel
        title="Activity"
        subtitle={`Generations per rolling 7-day window, last ${TREND_WEEKS} weeks.`}
      >
        {trend.every((b) => b.count === 0) ? (
          <Empty>No generations recorded in this window.</Empty>
        ) : (
          <div className="flex h-32 items-end gap-1">
            {trend.map((bucket, i) => (
              <div
                key={bucket.start.toISOString()}
                className="group flex h-full flex-1 flex-col items-center justify-end gap-1"
                title={`${bucket.count} in the week to ${bucket.end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
              >
                <span className="text-[11px] text-[var(--text-muted)] opacity-0 group-hover:opacity-100">
                  {bucket.count}
                </span>
                <span
                  className="w-full rounded-t bg-primary"
                  style={{
                    height: `${Math.max(trendPercents[i], bucket.count > 0 ? 2 : 0)}%`,
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="By type"
          subtitle={`What was generated, last ${TREND_WEEKS} weeks.`}
        >
          {byKind.length === 0 ? (
            <Empty>Nothing generated yet.</Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {byKind.map(([kind, n], i) => (
                <BarRow
                  key={kind}
                  label={KIND_LABELS[kind] ?? kind}
                  count={n}
                  percent={kindPercents[i]}
                />
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Most active brands" subtitle="Last 30 days.">
          {topBrands.length === 0 ? (
            <Empty>No brand activity in the last 30 days.</Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {topBrands.map((brand, i) => (
                <BarRow
                  key={brand.brandId}
                  label={brand.name}
                  count={brand.count}
                  percent={brandPercents[i]}
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
