"use client";

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
import { NotificationBell } from "./notification-bell";
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
  const { title, subtitle } = getPageMeta(pathname);
  const initials = (user.firstName[0] ?? "") + (user.lastName[0] ?? "");

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--border)] bg-background px-8">
      {/* Left — page title + subtitle */}
      <div>
        <h1 className="text-[20px] font-semibold leading-tight text-foreground">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
            {subtitle}
          </p>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-3">
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
            <form action="/api/auth/logout" method="POST">
              <DropdownMenuItem
                render={<button type="submit" />}
                className="w-full text-left text-[13px] text-[var(--text-secondary)] hover:text-[#d47575]"
              >
                Log out
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
