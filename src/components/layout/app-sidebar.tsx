"use client";

import { LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MAIN_NAV } from "@/lib/nav";

interface UserInfo {
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
}

export function AppSidebar({ user }: { user: UserInfo }) {
  const pathname = usePathname();
  const initials = (user.firstName[0] ?? "") + (user.lastName[0] ?? "");

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-[280px] flex-col border-r border-outline-variant bg-nav">
      {/* Logo Area */}
      <div className="flex items-center gap-3 px-6 py-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[#0a6d9e] text-sm font-bold text-white">
          KO
        </div>
        <div>
          <h1 className="font-[family-name:var(--font-heading)] text-lg font-semibold text-on-surface">
            KO OS
          </h1>
          <p className="text-xs text-on-surface-variant">Brand Brain</p>
        </div>
      </div>

      {/* Main Navigation */}
      <nav className="flex-1 space-y-1 px-3">
        {MAIN_NAV.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`relative flex items-center gap-3 rounded-lg px-4 py-2.5 text-[13px] font-medium transition-colors ${
                isActive
                  ? "text-foreground before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-primary"
                  : "text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-foreground"
              }`}
            >
              <Icon size={20} strokeWidth={1.75} />
              <span>{item.title}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom Section */}
      <div className="border-t border-outline-variant/30 px-3 py-3">
        <Link
          href="/settings"
          className="relative flex items-center gap-3 rounded-lg px-4 py-2.5 text-[13px] font-medium transition-colors text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-foreground"
        >
          <Settings size={20} />
          <span>Settings</span>
        </Link>
        <form action="/api/auth/logout" method="POST">
          <button
            type="submit"
            className="relative flex w-full items-center gap-3 rounded-lg px-4 py-2.5 text-[13px] font-medium transition-colors text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.04)] hover:text-foreground"
          >
            <LogOut size={20} />
            <span>Logout</span>
          </button>
        </form>
      </div>

      {/* User Avatar */}
      <div className="border-t border-outline-variant/30 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-sm font-semibold text-primary">
            {initials}
          </div>
          <div className="flex-1 truncate">
            <p className="truncate text-sm font-medium text-on-surface">
              {user.firstName} {user.lastName}
            </p>
            <p className="truncate text-xs text-on-surface-variant">
              {user.email}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
