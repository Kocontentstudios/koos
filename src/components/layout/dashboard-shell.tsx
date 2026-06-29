"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { AppSidebar } from "./app-sidebar";
import { SidebarCollapseProvider, useSidebarCollapse } from "./sidebar-context";
import { TopHeader } from "./top-header";

interface ShellUser {
  firstName: string;
  lastName: string;
  email: string;
  avatarUrl: string | null;
}

export function DashboardShell({
  user,
  children,
}: {
  user: ShellUser;
  children: React.ReactNode;
}) {
  return (
    <SidebarCollapseProvider>
      <ShellInner user={user}>{children}</ShellInner>
    </SidebarCollapseProvider>
  );
}

function ShellInner({
  user,
  children,
}: {
  user: ShellUser;
  children: React.ReactNode;
}) {
  const { collapsed } = useSidebarCollapse();

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar user={user} />
      <div
        className={cn(
          "flex min-h-screen flex-1 flex-col transition-[margin-left] duration-200",
          // No left margin on mobile (sidebar is an off-canvas drawer); the
          // sidebar reclaims its rail width only from md up.
          "ml-0",
          collapsed ? "md:ml-[72px]" : "md:ml-[240px]",
        )}
      >
        <TopHeader user={user}>
          <Link
            href="/brand/create"
            className="flex h-9 items-center gap-2 rounded-[10px] bg-primary px-3 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-[var(--primary-hover)]"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">Create Brand</span>
          </Link>
        </TopHeader>
        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
