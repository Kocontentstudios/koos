import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { getAuthUser } from "@/lib/auth/get-user";

export default async function Home() {
  const { dbUser } = await getAuthUser();
  if (dbUser) {
    redirect("/dashboard");
  }

  return (
    <>
      {/* Ambient panel rotation keyframe — CSS only, no client JS */}
      <style>{`
        @keyframes ko-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .ko-ambient-mark {
          animation: ko-spin 60s linear infinite;
        }
      `}</style>

      <div className="min-h-screen bg-background flex flex-col md:flex-row">
        {/* ── LEFT COLUMN ── */}
        <div className="flex-1 md:basis-[55%] flex flex-col px-8 py-10 md:px-16 md:py-14 relative z-10">
          {/* KO OS Wordmark */}
          <div className="flex items-center gap-2.5 mb-auto">
            <div
              aria-hidden="true"
              className="w-9 h-9 rounded-full bg-primary flex items-center justify-center shrink-0"
            >
              <span className="text-white text-xs font-bold leading-none">
                KO
              </span>
            </div>
            <span className="font-display text-lg font-bold text-foreground tracking-tight">
              OS
            </span>
          </div>

          {/* Vertically-centred hero block */}
          <div className="flex flex-col justify-center flex-1 py-16 md:py-0">
            <div className="max-w-[480px]">
              <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground leading-[1.1] tracking-tight mb-5">
                Your Brand Brain — powered by KO.
              </h1>
              <p className="text-[var(--text-secondary)] text-base md:text-lg leading-relaxed mb-10">
                AI-powered content strategies and calendars. Human designers
                bring them to life.
              </p>

              {/* CTA Row */}
              <div className="flex flex-col sm:flex-row gap-3">
                <Link
                  className={buttonVariants({
                    variant: "secondary",
                    size: "lg",
                  })}
                  href="/login"
                >
                  Login
                </Link>
                <Link
                  className={buttonVariants({ variant: "default", size: "lg" })}
                  href="/register"
                >
                  Start Creating
                </Link>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-auto pt-10">
            <Link
              className="text-[var(--text-muted)] text-[13px] hover:text-foreground transition-colors"
              href="/privacy"
            >
              Privacy Policy
            </Link>
          </div>
        </div>

        {/* ── RIGHT COLUMN (ambient panel, desktop only) ── */}
        <div
          aria-hidden="true"
          className="hidden md:flex md:basis-[45%] bg-surface-1 border-l border-[var(--border)] items-center justify-center overflow-hidden relative"
        >
          {/* Subtle glow blob */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/3 left-1/3 w-72 h-72 rounded-full bg-primary/5 blur-3xl" />
            <div className="absolute bottom-1/4 right-1/4 w-48 h-48 rounded-full bg-primary/3 blur-2xl" />
          </div>

          {/* Giant KO ambient mark */}
          <span
            className="ko-ambient-mark select-none font-display font-bold leading-none"
            style={{
              fontSize: "180px",
              color: "rgba(19,139,200,0.06)",
              letterSpacing: "-0.04em",
            }}
          >
            KO
          </span>
        </div>
      </div>
    </>
  );
}
