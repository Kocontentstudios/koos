import Link from "next/link";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Floating top bar — the homepage KO OS brand mark (left, links back to
          home) + theme toggle (right). Mirrors the landing nav so the top-left
          looks consistent when switching between home and the auth pages.
          Shared across login & register; sits above the centered auth card. */}
      <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-3 p-4 sm:p-6">
        <Link
          href="/"
          aria-label="KO OS — back to home"
          className="inline-flex items-center gap-2.5 transition-opacity hover:opacity-90"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-primary-fill text-sm font-extrabold leading-none text-primary-foreground">
            KO
          </span>
          <span className="text-base font-bold tracking-[-0.3px] text-foreground">
            KO OS
          </span>
        </Link>
        <ThemeToggle />
      </div>
      {children}
    </>
  );
}
