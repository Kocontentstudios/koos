import {
  CalendarDays,
  Lock,
  Palette,
  Sparkles,
  Target,
  WandSparkles,
} from "lucide-react";
import Link from "next/link";
import { WelcomeCard } from "@/app/(dashboard)/brand/onboarding/welcome-card";
import { buttonVariants } from "@/components/ui/button";

/** Mirrors the real dashboard's cards so the shape of the product is legible
 *  before it is usable — that is the point of letting someone look around. */
const LOCKED_CARDS = [
  {
    icon: Target,
    tint: "bg-[rgba(19,139,200,0.1)] text-primary",
    title: "Complete Your Brand",
    desc: "Tell KO who you are, and everything below unlocks.",
  },
  {
    icon: WandSparkles,
    tint: "bg-[rgba(168,85,247,0.1)] text-[#A855F7]",
    title: "Build a Strategy",
    desc: "Set up your brand to plan campaigns with KO AI.",
  },
  {
    icon: CalendarDays,
    tint: "bg-[rgba(236,72,153,0.1)] text-[#EC4899]",
    title: "Generate Your Calendar",
    desc: "Set up your brand to turn a strategy into a schedule.",
  },
  {
    icon: Palette,
    tint: "bg-[rgba(151,196,89,0.12)] text-success",
    title: "Request a Design",
    desc: "Set up your brand so designs come back on-brand.",
  },
] as const;

/**
 * The dashboard for someone who chose "Maybe later".
 *
 * A separate component rather than a brand-less branch through the real
 * dashboard: that page runs five brand-scoped queries and threads the brand
 * through several hundred lines of JSX, and making every one of them
 * null-tolerant to serve a preview would be a lot of risk for a look-around.
 *
 * Nothing here is clickable except the one thing that unlocks it. A card that
 * looks live and then redirects teaches the user not to trust the buttons.
 */
export function LockedDashboard({
  firstName,
  onboardingHref,
  showWelcome = false,
}: {
  firstName: string;
  onboardingHref: string;
  showWelcome?: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      {/* The greeting belongs over this page, not the onboarding route: with
          the dashboard open to brand-less users, this is where every auth path
          now ends, so /brand/onboarding is no longer where they first land. */}
      {showWelcome && <WelcomeCard onboardingHref={onboardingHref} />}
      <section className="rounded-2xl border border-[var(--border)] bg-gradient-to-b from-[var(--surface-2)] to-[var(--surface-1)] p-6 sm:p-8">
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-primary">
          <Sparkles aria-hidden="true" className="size-3.5" />
          One step to go
        </p>
        <h1 className="mt-3 font-display text-[26px] font-bold leading-tight text-foreground sm:text-[32px]">
          Welcome aboard, {firstName}
        </h1>
        <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed text-[var(--text-secondary)]">
          This is your workspace. Everything here — strategies, calendars,
          designs — works from your brand, so KO needs to learn it first. It
          takes about two minutes.
        </p>
        <Link
          href={onboardingHref}
          className={`${buttonVariants({ variant: "default", size: "lg" })} mt-6 h-12 px-6 text-[15px]`}
        >
          Set Up Your Brand
        </Link>
      </section>

      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold text-foreground">
          What you'll unlock
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {LOCKED_CARDS.map((card) => (
            <li
              key={card.title}
              // aria-disabled, not `disabled`: these are not controls the user
              // can focus and fail to operate, they are a preview.
              aria-disabled="true"
              className="flex gap-4 rounded-xl border border-[var(--border)] bg-surface-1 p-5 opacity-60"
            >
              <span
                aria-hidden="true"
                className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${card.tint}`}
              >
                <card.icon className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[15px] font-semibold text-foreground">
                  {card.title}
                  <Lock aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="sr-only">Locked</span>
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                  {card.desc}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
