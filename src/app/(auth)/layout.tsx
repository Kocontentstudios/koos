import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Floating top bar — back-to-home (left) + theme toggle (right).
          Shared across login & register; sits above the centered auth card. */}
      <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-3 p-4 sm:p-6">
        <Link
          href="/"
          className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-[var(--border)] bg-surface-1 px-3 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-hover)] hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">Back to home</span>
        </Link>
        <ThemeToggle />
      </div>
      {children}
    </>
  );
}
