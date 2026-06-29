import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  ListChecks,
  PieChart,
  Sparkles,
  Target,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { requireBrand } from "@/lib/auth/require-brand";
import {
  getDesignTicketsByUser,
  getStrategiesByBrand,
} from "@/lib/db/queries";
import { formatTicketNumber } from "@/lib/design/ticket";

function relativeTime(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default async function DashboardPage() {
  const { dbUser, brand } = await requireBrand();

  const [strategies, ticketRows] = await Promise.all([
    getStrategiesByBrand(brand.id),
    getDesignTicketsByUser(dbUser.id),
  ]);

  const now = new Date();
  const firstName = dbUser.firstName ?? "there";

  // ── Getting-started checklist (wired to real state) ───────────────────
  const checklist = [
    {
      key: "account",
      title: "Create your account",
      desc: "You are all set up and verified",
      done: true,
    },
    {
      key: "brand",
      title: "Create your brand",
      desc: "Define your brand identity",
      done: brand.onboardingStatus === "completed",
    },
    {
      key: "logo",
      title: "Upload your brand logo",
      desc: "Add your visual identity to get started",
      done: Boolean(brand.logoUrl),
    },
    {
      key: "platforms",
      title: "Choose your platforms",
      desc: "Tell us where your audience lives",
      done: Boolean(brand.platforms && brand.platforms.length > 0),
    },
    {
      key: "strategy",
      title: "Build your first strategy",
      desc: "Generate a campaign plan with KO AI",
      done: strategies.length > 0,
    },
  ];
  const doneCount = checklist.filter((c) => c.done).length;
  const total = checklist.length;
  const pct = Math.round((doneCount / total) * 100);
  const remaining = total - doneCount;

  // Progress ring geometry (r = 60 → circumference ≈ 377)
  const circumference = 2 * Math.PI * 60;
  const dashOffset = circumference * (1 - pct / 100);

  // ── Recent activity (from real data, newest first) ────────────────────
  const latestStrategy = strategies[0];
  const latestTicket = ticketRows[0]?.ticket;
  const activity = [
    dbUser.createdAt
      ? {
          dot: "var(--primary)",
          title: "Account created successfully",
          desc: "Welcome to KO OS — your workspace is ready",
          at: dbUser.createdAt,
        }
      : null,
    brand.onboardingStatus === "completed"
      ? {
          dot: "var(--success)",
          title: "Brand profile created",
          desc: `${brand.name} is ready for strategies and design`,
          at: brand.updatedAt ?? brand.createdAt,
        }
      : null,
    latestStrategy
      ? {
          dot: "var(--warning)",
          title: "Strategy generated",
          desc: latestStrategy.name,
          at: latestStrategy.createdAt,
        }
      : null,
    latestTicket
      ? {
          dot: "var(--primary)",
          title: "Design ticket submitted",
          desc: formatTicketNumber(latestTicket.ticketNumber),
          at: latestTicket.createdAt,
        }
      : null,
  ]
    .filter((a): a is NonNullable<typeof a> => a !== null)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 4);

  const actionCards = [
    {
      icon: Target,
      tint: "bg-[rgba(19,139,200,0.1)] text-primary",
      title: "Set Up Your Brand",
      desc: "Complete your brand profile with logo, colors, and guidelines.",
      href: "/brand/create",
    },
    {
      icon: WandSparkles,
      tint: "bg-[rgba(168,85,247,0.1)] text-[#A855F7]",
      title: "Build a Strategy",
      desc: "Chat with KO AI to create a campaign strategy for your goals.",
      href: "/strategy",
    },
    {
      icon: CalendarDays,
      tint: "bg-[rgba(236,72,153,0.1)] text-[#EC4899]",
      title: "View Your Calendar",
      desc: "See your day-by-day content schedule and request designs.",
      href: "/calendar",
    },
  ];

  return (
    <div className="flex flex-col gap-7">
      {/* ── Welcome hero ── */}
      <div className="relative overflow-hidden rounded-[20px] bg-gradient-to-br from-[#00204F] to-[#00162E] p-6 md:p-9">
        <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-[#85B7EB]">
          <Sparkles size={11} />{" "}
          {doneCount === total ? "All set" : "Getting started"}
        </span>
        <h2 className="font-display text-[26px] font-bold text-white md:text-[30px]">
          Welcome aboard, {firstName}
        </h2>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-[#A7B6C7]">
          Your brand workspace is ready. Complete your setup to unlock the full
          power of KO OS and start building campaigns that convert.
        </p>
        <div className="mt-6 flex flex-wrap gap-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-[#85B7EB]">
              <CheckCircle2 size={18} />
            </div>
            <div>
              <h4 className="text-lg font-bold text-white">
                {doneCount}/{total}
              </h4>
              <span className="text-xs text-[#A7B6C7]">Setup complete</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-[#85B7EB]">
              <Clock size={18} />
            </div>
            <div>
              <h4 className="text-lg font-bold text-white">~3 min</h4>
              <span className="text-xs text-[#A7B6C7]">Time to finish</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Progress: ring + checklist ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_2fr]">
        {/* Ring */}
        <div className="rounded-2xl border border-[var(--border)] bg-surface-1 p-5 md:p-6">
          <h3 className="mb-5 flex items-center gap-2 text-[15px] font-bold text-foreground">
            <PieChart size={16} className="text-primary" /> Your Progress
          </h3>
          <div className="flex flex-col items-center gap-4">
            <div className="relative h-[140px] w-[140px]">
              <svg
                width="140"
                height="140"
                className="-rotate-90"
                aria-hidden="true"
              >
                <circle
                  cx="70"
                  cy="70"
                  r="60"
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth="8"
                />
                <circle
                  cx="70"
                  cy="70"
                  r="60"
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  style={{ transition: "stroke-dashoffset 1.5s ease" }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-foreground">
                  {pct}
                </span>
                <p className="text-xs text-[var(--text-muted)]">percent</p>
              </div>
            </div>
            <div className="text-center text-[13px] text-[var(--text-secondary)]">
              {remaining === 0 ? (
                <>Setup complete — nice work!</>
              ) : (
                <>
                  Complete{" "}
                  <strong className="text-foreground">
                    {remaining} more step{remaining > 1 ? "s" : ""}
                  </strong>{" "}
                  to finish setup
                </>
              )}
            </div>
          </div>
        </div>

        {/* Checklist */}
        <div className="rounded-2xl border border-[var(--border)] bg-surface-1 p-5 md:p-6">
          <h3 className="mb-5 flex items-center gap-2 text-[15px] font-bold text-foreground">
            <ListChecks size={16} className="text-success" /> Getting Started
            Checklist
          </h3>
          <div className="flex flex-col gap-2.5">
            {checklist.map((item) => (
              <div
                key={item.key}
                className={`flex items-center gap-3 rounded-xl border p-3.5 transition-colors ${
                  item.done
                    ? "border-success bg-[rgba(151,196,89,0.12)]"
                    : "border-[var(--border)] bg-surface-2"
                }`}
              >
                <div
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                    item.done
                      ? "border-success bg-success text-white"
                      : "border-[var(--border)] text-transparent"
                  }`}
                >
                  <Check size={12} strokeWidth={3} />
                </div>
                <div>
                  <h4
                    className={`text-[13px] font-semibold ${
                      item.done ? "text-success" : "text-foreground"
                    }`}
                  >
                    {item.title}
                  </h4>
                  <p className="text-[12px] text-[var(--text-muted)]">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Action cards ── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {actionCards.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.title}
              href={c.href}
              className="group relative rounded-2xl border border-[var(--border)] bg-surface-1 p-5 pb-16 transition-colors hover:border-[var(--border-accent)]"
            >
              <div
                className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl ${c.tint}`}
              >
                <Icon size={20} />
              </div>
              <h4 className="text-[15px] font-bold text-foreground">
                {c.title}
              </h4>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                {c.desc}
              </p>
              <span className="absolute bottom-5 right-5 flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 text-[var(--text-muted)] transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <ArrowRight size={16} />
              </span>
            </Link>
          );
        })}
      </div>

      {/* ── Activity + Pro tip ── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-2xl border border-[var(--border)] bg-surface-1 p-5 md:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-[15px] font-bold text-foreground">
              Recent Activity
            </h3>
            <Link
              href="/calendar"
              className="text-[13px] font-medium text-primary hover:text-[var(--primary-hover)]"
            >
              View all
            </Link>
          </div>
          <div className="flex flex-col">
            {activity.map((a) => (
              <div
                key={a.title}
                className="flex items-start gap-3 border-b border-[var(--divider)] py-3 last:border-0"
              >
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: a.dot }}
                />
                <div className="flex-1">
                  <h4 className="text-[13px] font-semibold text-foreground">
                    {a.title}
                  </h4>
                  <p className="text-[12px] text-[var(--text-muted)]">
                    {a.desc}
                  </p>
                </div>
                <span className="shrink-0 text-[12px] text-[var(--text-muted)]">
                  {relativeTime(new Date(a.at), now)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[var(--border)] border-l-[3px] border-l-[var(--warning)] bg-surface-1 p-5">
          <h4 className="text-[15px] font-bold text-[var(--warning)]">Pro Tip</h4>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-secondary)]">
            Brands with complete profiles see richer AI output. Fill in your
            audience, voice, and platforms to unlock sharper strategies and
            on-brand designs.
          </p>
          <Link
            href="/brand/create"
            className="mt-4 inline-flex h-9 items-center rounded-lg bg-[var(--status-pending-bg)] px-4 text-[13px] font-semibold text-[var(--status-pending-fg)] transition-colors hover:bg-[rgba(212,169,84,0.28)]"
          >
            Complete Profile
          </Link>
        </div>
      </div>
    </div>
  );
}
