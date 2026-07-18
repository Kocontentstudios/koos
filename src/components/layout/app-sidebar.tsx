"use client";

import {
  Loader2Icon,
  LogOut,
  PanelLeft,
  PanelLeftClose,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { MAIN_NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { LogoutForm } from "./logout-form";
import { useSidebarCollapse } from "./sidebar-context";

interface UserInfo {
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
}

export function AppSidebar({ user }: { user: UserInfo }) {
  const pathname = usePathname();
  const { collapsed, toggle, mobileOpen, closeMobile } = useSidebarCollapse();
  const initials = (user.firstName[0] ?? "") + (user.lastName[0] ?? "");

  // Close the mobile drawer whenever the route changes (e.g. after a nav tap).
  // biome-ignore lint/correctness/useExhaustiveDependencies(pathname): pathname is the intentional trigger — the effect must re-run on every route change even though the callback doesn't read it
  useEffect(() => {
    closeMobile();
  }, [pathname, closeMobile]);

  // Shared link styling. `collapsed` only affects the layout at md+ — on mobile
  // the sidebar is an always-expanded drawer, so labels stay visible.
  const rowBase =
    "relative flex items-center gap-3 rounded-lg py-2.5 text-[13px] font-medium transition-colors";
  const rowPad = cn("px-4", collapsed && "md:justify-center md:px-0");
  const rowIdle =
    "text-[var(--nav-text)] hover:bg-[var(--nav-hover)] hover:text-[var(--nav-text-active)]";
  // Hide labels only on the desktop icon-rail (md+ when collapsed).
  const labelHidden = collapsed ? "md:hidden" : undefined;

  return (
    <>
      {/* Backdrop — only on mobile while the drawer is open */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={closeMobile}
          className="fixed inset-0 z-40 bg-[var(--backdrop)] md:hidden"
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-0 z-50 flex h-screen flex-col border-r border-[var(--nav-border)] bg-nav",
          "w-[240px] transition-transform duration-200 md:transition-[width,transform]",
          collapsed ? "md:w-[72px]" : "md:w-[240px]",
          // Off-canvas on mobile unless opened; always on-canvas at md+.
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "md:translate-x-0",
        )}
      >
        {/* Logo Area */}
        <div
          className={cn(
            "flex items-center gap-3 px-6 py-6",
            collapsed && "md:justify-center md:px-0",
          )}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[#0a6d9e] text-sm font-bold text-white">
            KO
          </div>
          <div className={cn("min-w-0", labelHidden)}>
            <h1 className="font-[family-name:var(--font-heading)] text-lg font-semibold text-[var(--nav-text-active)]">
              KO OS
            </h1>
            <p className="text-xs text-[var(--nav-text)]">Brand Brain</p>
          </div>
        </div>

        {/* Collapse toggle — desktop only (mobile uses the drawer) */}
        <div
          className={cn(
            "hidden pb-2 md:block",
            collapsed && "md:flex md:justify-center md:px-0",
            !collapsed && "md:px-3",
          )}
        >
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex items-center justify-center rounded-lg p-2 text-[var(--nav-text)] transition-colors hover:bg-[var(--nav-hover)] hover:text-[var(--nav-text-active)]"
          >
            {collapsed ? <PanelLeft size={20} /> : <PanelLeftClose size={20} />}
          </button>
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
                onClick={closeMobile}
                aria-current={isActive ? "page" : undefined}
                title={collapsed ? item.title : undefined}
                className={cn(
                  rowBase,
                  rowPad,
                  isActive
                    ? "bg-[var(--nav-hover)] text-[var(--nav-text-active)] before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-primary"
                    : rowIdle,
                )}
              >
                <Icon size={20} strokeWidth={1.75} />
                <span className={labelHidden}>{item.title}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom Section */}
        <div className="border-t border-[var(--nav-border)] px-3 py-3">
          <Link
            href="/settings"
            onClick={closeMobile}
            title={collapsed ? "Settings" : undefined}
            className={cn(rowBase, rowPad, rowIdle)}
          >
            <Settings size={20} />
            <span className={labelHidden}>Settings</span>
          </Link>
          <LogoutForm>
            {(pending) => (
              <button
                type="submit"
                disabled={pending}
                aria-busy={pending}
                title={collapsed ? "Logout" : undefined}
                className={cn(
                  rowBase,
                  rowPad,
                  "w-full",
                  rowIdle,
                  "disabled:opacity-60",
                )}
              >
                {pending ? (
                  <Loader2Icon size={20} className="animate-spin" />
                ) : (
                  <LogOut size={20} />
                )}
                <span className={labelHidden}>
                  {pending ? "Logging out…" : "Logout"}
                </span>
              </button>
            )}
          </LogoutForm>
        </div>

        {/* User Card */}
        <div className="px-3 pb-4">
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl border border-[var(--nav-border)] bg-[var(--nav-card)] p-3",
              collapsed &&
                "md:justify-center md:border-transparent md:bg-transparent md:p-2",
            )}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#e8a0b0] to-[#7c5cff] text-sm font-semibold text-white">
              {initials}
            </div>
            <div className={cn("min-w-0 flex-1", labelHidden)}>
              <p className="truncate text-sm font-medium text-[var(--nav-text-active)]">
                {user.firstName} {user.lastName}
              </p>
              <p className="truncate text-xs text-[var(--nav-text)]">
                {user.email}
              </p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
