import Link from "next/link";
import { redirect } from "next/navigation";
import { StatCard } from "@/app/admin/stat-card";
import { ADMIN_RANGES } from "@/lib/admin/scope";
import {
  type AdminScope,
  adminScopeHref,
  DEFAULT_SCOPE,
  loadAdminScope,
  USAGE_KINDS,
} from "@/lib/admin/scope-params";
import {
  analyticsFilterFrom,
  describeWindow,
  previousWindow,
} from "@/lib/analytics/filter";
import { recordsHref } from "@/lib/analytics/records";
import {
  bucketByPeriod,
  formatDuration,
  median,
  percentChange,
  toBarPercentages,
} from "@/lib/analytics/rollup";
import { requireRole } from "@/lib/auth/require-role";
import {
  countActiveBrandOptions,
  getActiveBrandCount,
  getApprovalDurations,
  getBrandFilterOptions,
  getSignups,
  getTickets,
  getTopBrandsByActivity,
  getUsageEvents,
} from "@/lib/db/queries";
import { humanizeStatus, TICKET_STATUSES } from "@/lib/design/tickets-ui";
import { AnalyticsFilterBar, type FilterGroup } from "./filter-bar";

/** What /admin/analytics shows before anyone chooses. See the note below. */
const ANALYTICS_DEFAULT_RANGE = "30d" as const;

const KIND_LABELS: Record<string, string> = {
  strategy_generated: "Strategy",
  calendar_generated: "Calendar",
  design_ticket_created: "Design ticket",
  design_generated: "Design image",
};

/**
 * How many days one bar covers, so any window fits in a legible chart.
 *
 * A fixed 7-day bucket makes "last 7 days" a single bar and "all time" hundreds
 * of them. Sized to land between roughly 6 and 20 bars for every preset.
 */
export function trendBucketDays(windowDaysSpan: number): number {
  if (windowDaysSpan <= 14) return 1;
  if (windowDaysSpan <= 60) return 7;
  if (windowDaysSpan <= 240) return 14;
  return 30;
}

/** Adds or removes one value, so a chip is its own toggle. */
function toggle<T extends string>(current: readonly T[], value: T): T[] {
  return current.includes(value)
    ? current.filter((v) => v !== value)
    : [...current, value];
}

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

/**
 * One row of a breakdown, optionally opening its own records.
 *
 * The whole row is the link, not just the label: the number is what the
 * operator is reaching for, and a 28px label is a small target.
 */
function BarRow({
  label,
  count,
  percent,
  href,
}: {
  label: string;
  count: number;
  percent: number;
  href?: string;
}) {
  const body = (
    <>
      <span className="w-28 shrink-0 text-[13px] text-[var(--text-secondary)]">
        {label}
      </span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--border)]">
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="w-10 shrink-0 text-right text-[13px] font-medium text-foreground tabular-nums">
        {count}
      </span>
    </>
  );

  return (
    <li>
      {href ? (
        <Link
          href={href}
          className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-[var(--hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
        >
          {body}
        </Link>
      ) : (
        <span className="flex items-center gap-3 px-2 py-1">{body}</span>
      )}
    </li>
  );
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(["admin"]);

  const now = new Date();
  const params = await searchParams;
  const scope = loadAdminScope(params);

  /* Redirected, not coerced. These six queries fetch raw timestamps to bucket
     in JS, so the shared default of `range=all` means six unbounded table scans
     on every load of the bare URL — and past MAX_ROWS the cards silently cap
     while their drill-down counts do not, so a card and the list it opens stop
     agreeing.
     A redirect rather than a silent override because `?range=all` and no
     `range` at all are indistinguishable after parsing (the serializer drops a
     value equal to the default), so overriding would have ignored an operator
     who explicitly chose All time. Stating the default in the URL makes the two
     different again. */
  if (params.range === undefined) {
    redirect(
      adminScopeHref("/admin/analytics", scope, {
        range: ANALYTICS_DEFAULT_RANGE,
      }),
    );
  }

  const filter = analyticsFilterFrom(scope, now);
  const previous = previousWindow(filter, now);

  const [
    usage,
    signups,
    tickets,
    activeBrands,
    topBrands,
    approvalMs,
    brandOptions,
    brandOptionTotal,
  ] = await Promise.all([
    getUsageEvents(filter),
    getSignups(filter),
    getTickets(filter),
    getActiveBrandCount(filter),
    getTopBrandsByActivity(filter),
    getApprovalDurations(filter),
    getBrandFilterOptions(filter),
    countActiveBrandOptions(filter),
  ]);

  /* The same window, shifted back by its own length — a like-for-like
     comparison. A 30-day selection compared against the previous 7 days would
     report growth that is an artefact of the window. Null for "all time",
     where there is no previous period, and the cards then show no delta at
     all rather than a meaningless one. */
  const [prevUsage, prevSignups, prevTickets] = previous
    ? await Promise.all([
        getUsageEvents({ ...filter, ...previous }),
        getSignups({ ...filter, ...previous }),
        getTickets({ ...filter, ...previous }),
      ])
    : [null, null, null];

  const usageTimes = usage.map((e) => e.createdAt);
  const changeFor = (current: number, prev: unknown[] | null) =>
    prev === null ? undefined : percentChange(current, prev.length);

  /* The chart must COVER the window, exactly. Two mistakes were possible and
     both were made: clamping to TREND_WEEKS truncated a 90-day selection so the
     bars summed to 84 under a card reading 90, and a floor of two buckets gave
     "last 7 days" one full bar beside a permanently empty one. The bucket size
     is chosen so the whole window fits in a readable number of bars, and the
     count is the ceiling of the window over that size — so the bars always sum
     to the card above them. */
  /* For "all time" the window has no length of its own, so the chart takes its
     span from the data — the oldest event to now. Falling back to
     filter.periodDays (0) would render a single one-day bar for all history. */
  const chartEnd = filter.to ?? now;
  const oldest = usageTimes.reduce<Date | null>(
    (min, t) => (min === null || t < min ? t : min),
    null,
  );
  const spanDays =
    filter.periodDays ||
    (oldest
      ? Math.max(
          1,
          Math.ceil((chartEnd.getTime() - oldest.getTime()) / 86_400_000),
        )
      : 1);
  const bucketDays = trendBucketDays(spanDays);
  const trend = bucketByPeriod(usageTimes, {
    now: chartEnd,
    periodDays: bucketDays,
    periods: Math.max(1, Math.ceil(spanDays / bucketDays)),
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
  const window = describeWindow(filter);

  const href = (patch: Partial<AdminScope>) =>
    adminScopeHref("/admin/analytics", scope, patch);

  const groups: FilterGroup[] = [
    {
      legend: "Date range",
      choices: ADMIN_RANGES.filter((r) => r !== "custom").map((range) => ({
        key: range,
        label:
          range === "all" ? "All time" : `Last ${range.replace("d", "")} days`,
        href: href({ range, from: "", to: "", page: 1 }),
        active: scope.range === range,
      })),
    },
    {
      legend: "Activity type",
      choices: USAGE_KINDS.map((kind) => ({
        key: kind,
        label: KIND_LABELS[kind] ?? kind,
        href: href({ kind: toggle(scope.kind, kind), page: 1 }),
        active: scope.kind.includes(kind),
      })),
    },
    {
      legend:
        brandOptionTotal > brandOptions.length
          ? `Brand (top ${brandOptions.length} of ${brandOptionTotal})`
          : "Brand",
      /* Already the most active twelve for this window — see
         getBrandFilterOptions. Slicing an alphabetical list here is what made
         the busiest brand unselectable. */
      choices: brandOptions.map((b) => ({
        key: b.id,
        label: b.name,
        href: href({ brand: scope.brand === b.id ? "" : b.id, page: 1 }),
        active: scope.brand === b.id,
      })),
    },
    {
      legend: "Ticket status",
      choices: TICKET_STATUSES.map((status) => ({
        key: status,
        label: humanizeStatus(status),
        href: href({ status: toggle(scope.status, status), page: 1 }),
        active: scope.status.includes(status),
      })),
    },
  ];

  const activeCount =
    (scope.range === DEFAULT_SCOPE.range ? 0 : 1) +
    (scope.kind.length ? 1 : 0) +
    (scope.brand ? 1 : 0) +
    (scope.status.length ? 1 : 0);

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

      <AnalyticsFilterBar
        groups={groups}
        activeCount={activeCount}
        clearHref={adminScopeHref("/admin/analytics", DEFAULT_SCOPE)}
      />

      {/* Every caption is derived from the resolved window. Hardcoded ones
          ("last 7 days") become lies the moment a filter is applied. */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Generations"
          value={usage.length}
          change={changeFor(usage.length, prevUsage)}
          caption={window}
          href={recordsHref(scope, "generations")}
        />
        <StatCard
          label="Active brands"
          value={activeBrands}
          caption={window}
          href={recordsHref(scope, "brands")}
        />
        {/* A signup belongs to no brand and has no ticket status, so those two
            filters cannot narrow this. The caption says so rather than leaving
            an unnarrowed number under a "filters applied" badge, where the
            figure would read as an answer to a question it never heard. */}
        <StatCard
          label="New users"
          value={signups.length}
          change={changeFor(signups.length, prevSignups)}
          caption={
            scope.brand || scope.status.length || scope.kind.length
              ? `${window} · all brands`
              : window
          }
          href={recordsHref(scope, "users")}
        />
        <StatCard
          label="Tickets"
          value={tickets.length}
          change={changeFor(tickets.length, prevTickets)}
          caption={window}
          href={recordsHref(scope, "tickets")}
        />
        <StatCard
          label="Time to approval"
          value={formatDuration(median(approvalMs))}
          caption={`median of ${approvalMs.length} approved`}
          href={recordsHref(scope, "approvals")}
        />
      </section>

      <Panel
        title="Activity"
        subtitle={`Generations per ${bucketDays === 1 ? "day" : `${bucketDays}-day period`}, ${window}.`}
      >
        {trend.every((b) => b.count === 0) ? (
          <Empty>No generations recorded in this window.</Empty>
        ) : (
          <div className="flex h-32 items-end gap-1">
            {trend.map((bucket, i) => (
              <div
                key={bucket.start.toISOString()}
                data-trend-bar=""
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
        {/* The ticket asks for this to be EXPLAINED, not just linked: "By
            Type" names nothing on its own. */}
        <Panel
          title="By type"
          subtitle={`What KO OS produced — strategies, calendars, design tickets and generated images — ${window}.`}
        >
          {byKind.length === 0 ? (
            <Empty>Nothing generated in this window.</Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {byKind.map(([kind, n], i) => (
                <BarRow
                  key={kind}
                  label={KIND_LABELS[kind] ?? kind}
                  count={n}
                  percent={kindPercents[i]}
                  href={recordsHref(scope, "generations", {
                    kind: [kind as (typeof USAGE_KINDS)[number]],
                  })}
                />
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Most active brands" subtitle={`Activity ${window}.`}>
          {topBrands.length === 0 ? (
            <Empty>No brand activity in this window.</Empty>
          ) : (
            <ul className="flex flex-col gap-3">
              {topBrands.map((brand, i) => (
                <BarRow
                  key={brand.brandId}
                  label={brand.name}
                  count={brand.count}
                  percent={brandPercents[i]}
                  href={recordsHref(scope, "generations", {
                    brand: brand.brandId,
                  })}
                />
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
