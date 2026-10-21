import { ThemeToggle } from "@/components/layout/theme-toggle";
import { SignOutButton } from "./sign-out-button";

export default function AccessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-[76px] items-center gap-2 border-b border-[var(--border)] px-5 sm:h-[92px] sm:gap-6 sm:px-8 xl:px-16">
        <div className="mr-auto flex items-center gap-2.5 sm:gap-3.5">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-primary-fill text-sm font-extrabold text-primary-foreground sm:h-12 sm:w-12 sm:rounded-[15px] sm:text-xl"
          >
            KO
          </span>
          <div>
            <p className="whitespace-nowrap font-display text-lg font-bold leading-[22px] sm:text-[22px] sm:leading-7">
              KO OS
            </p>
            <p className="whitespace-nowrap text-xs text-[var(--text-secondary)] sm:text-sm">
              Brand Brain
            </p>
          </div>
        </div>
        <p className="hidden text-[15px] text-[var(--text-secondary)] md:block">
          Your brand. Your workspace.
        </p>
        <ThemeToggle className="[&_button]:size-8 sm:[&_button]:size-9 xl:[&_button]:size-11 xl:[&_svg]:size-5" />
        <SignOutButton />
      </header>
      {children}
    </div>
  );
}
