"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNotificationMessage } from "@/lib/design/tickets-ui";

interface NotificationItem {
  id: string;
  type: "design_ready" | "ticket_status" | "system";
  payload: unknown;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  items: NotificationItem[];
  unread: number;
}

const QUERY_KEY = ["notifications"];

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function NotificationBell() {
  const queryClient = useQueryClient();

  const { data, isPending, isError, isFetching, refetch } =
    useQuery<NotificationsResponse>({
      queryKey: QUERY_KEY,
      queryFn: async () => {
        const res = await fetch("/api/notifications");
        if (!res.ok) throw new Error("Failed to load notifications");
        return res.json();
      },
      refetchInterval: 30_000,
    });

  const markRead = useMutation({
    mutationFn: async () => {
      await fetch("/api/notifications/read", { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  function onOpenChange(open: boolean) {
    if (open && unread > 0) markRead.mutate();
  }

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
        }
        className="relative flex h-10 w-10 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[rgba(255,255,255,0.06)] hover:text-foreground"
      >
        <Bell size={20} />
        {unread > 0 && (
          <span
            aria-hidden="true"
            className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#d47575] ring-2 ring-background"
          />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[320px] p-0">
        <div className="border-b border-[var(--border)] px-3 py-2 text-[13px] font-semibold text-foreground">
          Notifications
        </div>
        {isPending ? (
          // Loading is not emptiness. This previously fell through to "You are
          // all caught up.", telling the user there was nothing to see before
          // anything had been fetched.
          // The announcement lives here, not on DropdownMenuContent: the menu
          // primitive owns its own role and drops an override.
          <div
            className="flex flex-col gap-1 py-1"
            role="status"
            aria-busy="true"
            aria-label="Loading notifications"
          >
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-1 px-3 py-2">
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-2.5 w-20" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
            <p className="text-[13px] text-[var(--text-secondary)]">
              Couldn't load notifications.
            </p>
            <Button
              variant="secondary"
              size="sm"
              loading={isFetching}
              loadingText="Retrying…"
              onClick={() => refetch()}
            >
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-[var(--text-secondary)]">
            You are all caught up.
          </p>
        ) : (
          <ul className="max-h-80 overflow-y-auto py-1">
            {items.map((n) => (
              <li
                key={n.id}
                className="flex flex-col gap-0.5 px-3 py-2 hover:bg-surface-2"
              >
                <span className="text-[13px] text-foreground">
                  {formatNotificationMessage(n)}
                </span>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {timeAgo(n.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
