"use client";

import { Loader2Icon, Menu, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getPageMeta } from "@/lib/nav";
import { LogoutForm } from "./logout-form";
import { NotificationBell } from "./notification-bell";
import { useSidebarCollapse } from "./sidebar-context";
import { ThemeToggle } from "./theme-toggle";

interface UserInfo {
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl?: string | null;
}

export function TopHeader({
  user,
  children,
}: {
  user: UserInfo;
  /** Optional action slot rendered on the right (e.g. a primary button). */
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  const { openMobile } = useSidebarCollapse();
  const { title, subtitle } = getPageMeta(pathname);
  const initials = (user.firstName[0] ?? "") + (user.lastName[0] ?? "");

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-[var(--border)] bg-background px-4 md:px-8">
      {/* Left — hamburger (mobile) + page title + subtitle */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={openMobile}
          aria-label="Open menu"
          className="-ml-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover)] hover:text-foreground md:hidden"
        >
          <Menu size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-semibold leading-tight text-foreground md:text-[20px]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 hidden truncate text-[13px] text-[var(--text-muted)] sm:block">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center gap-2 md:gap-3">
        {/* Search — UI shell; wire to real search when available */}
        <div className="relative hidden lg:block">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            type="search"
            aria-label="Search"
            placeholder="Search…"
            className="h-9 w-56 rounded-[10px] border border-[var(--border)] bg-surface-1 pl-9 pr-3 text-[13px] text-foreground placeholder:text-[var(--text-muted)]"
          />
        </div>

        {children}

        <ThemeToggle />

        <NotificationBell />

        {/* Avatar Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-nav text-sm font-semibold text-white"
          >
            {initials}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[200px]">
            <DropdownMenuItem render={<Link href="/settings" />}>
              Account Settings
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/privacy" />}>
              Privacy Policy
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <LogoutForm>
              {(pending) => (
                <DropdownMenuItem
                  render={
                    <button
                      type="submit"
                      disabled={pending}
                      aria-busy={pending}
                    />
                  }
                  closeOnClick={false}
                  className="w-full text-left text-[13px] text-[var(--text-secondary)] hover:text-[#d47575]"
                >
                  {pending && (
                    <Loader2Icon
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  {pending ? "Logging out…" : "Log out"}
                </DropdownMenuItem>
              )}
            </LogoutForm>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
