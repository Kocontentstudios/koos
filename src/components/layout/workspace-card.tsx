"use client";

import { Check, ChevronsUpDown, Settings2, Users } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface WorkspaceInfo {
  id: string;
  name: string;
  logoUrl: string | null;
  role: "owner" | "member";
}

function roleLabel(role: "owner" | "member") {
  return role === "owner" ? "Owner" : "Member";
}

function WorkspaceAvatar({ ws }: { ws: WorkspaceInfo }) {
  if (ws.logoUrl) {
    return (
      // biome-ignore lint/performance/noImgElement: arbitrary workspace logo URL, not optimizable by next/image
      <img
        src={ws.logoUrl}
        alt=""
        className="h-9 w-9 shrink-0 rounded-lg object-cover"
      />
    );
  }
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-[#7c5cff] text-sm font-semibold text-white">
      {ws.name.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function WorkspaceCard({
  collapsed,
  active,
  memberships,
}: {
  collapsed: boolean;
  active: WorkspaceInfo;
  memberships: WorkspaceInfo[];
}) {
  const [pending, startTransition] = useTransition();

  function switchTo(workspaceId: string) {
    if (workspaceId === active.id) return;
    startTransition(async () => {
      const res = await fetch("/api/workspace/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      // Full reload on purpose: the entire context (brands, chats,
      // calendars) changes — reset the world instead of patching caches.
      if (res.ok) window.location.assign("/dashboard");
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        aria-label="Workspace menu"
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border border-[var(--nav-border)] bg-[var(--nav-card)] p-3 text-left transition-colors hover:bg-[var(--nav-hover)] disabled:opacity-60",
          collapsed &&
            "md:justify-center md:border-transparent md:bg-transparent md:p-2",
        )}
      >
        <WorkspaceAvatar ws={active} />
        <div className={cn("min-w-0 flex-1", collapsed && "md:hidden")}>
          <p className="truncate text-sm font-medium text-[var(--nav-text-active)]">
            {active.name}
          </p>
          <p className="truncate text-xs text-[var(--nav-text)]">
            {roleLabel(active.role)}
          </p>
        </div>
        <ChevronsUpDown
          size={16}
          className={cn(
            "shrink-0 text-[var(--nav-text)]",
            collapsed && "md:hidden",
          )}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {memberships.map((ws) => (
            <DropdownMenuItem key={ws.id} onClick={() => switchTo(ws.id)}>
              <span className="flex-1 truncate">{ws.name}</span>
              <span className="text-xs text-muted-foreground">
                {roleLabel(ws.role)}
              </span>
              {ws.id === active.id && <Check size={14} />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/team" />}>
          <Users size={16} /> Team
        </DropdownMenuItem>
        {active.role === "owner" && (
          <DropdownMenuItem render={<Link href="/workspace/settings" />}>
            <Settings2 size={16} /> Workspace Settings
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
