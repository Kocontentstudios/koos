"use client";

import { Bell, Building2 } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface UserInfo {
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl?: string | null;
}

export function TopHeader({
  title,
  user,
  brandName,
  children,
}: {
  title: string;
  user: UserInfo;
  brandName?: string;
  children?: React.ReactNode;
}) {
  const initials = (user.firstName[0] ?? "") + (user.lastName[0] ?? "");

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-outline-variant/30 bg-background/80 px-6 backdrop-blur-xl">
      {/* Left Side */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-on-surface-variant">
          <Building2 size={16} />
          <span>{user.firstName}&apos;s Workspace</span>
          {brandName && (
            <>
              <span className="text-on-surface-variant">/</span>
              <span className="font-medium text-on-surface">{brandName}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-on-surface-variant">/</span>
          <span className="font-medium text-on-surface">{title}</span>
        </div>
      </div>

      {/* Right Side */}
      <div className="flex items-center gap-3">
        {children}

        {/* Notification Bell */}
        {/* TODO Phase 4: wire unread dot badge when notification data is available */}
        <button
          type="button"
          aria-label="Notifications"
          className="relative flex h-10 w-10 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.06)] hover:text-foreground"
        >
          <Bell size={20} />
        </button>

        {/* Avatar Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Account menu"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-nav text-sm font-semibold text-foreground"
          >
            {initials}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[200px]">
            <DropdownMenuItem disabled>Account Settings</DropdownMenuItem>
            <DropdownMenuItem>
              <Link href="/privacy" className="w-full">
                Privacy Policy
              </Link>
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
