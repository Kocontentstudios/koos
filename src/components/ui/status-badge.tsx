import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeStatus =
  | "draft"
  | "in_progress"
  | "ready"
  | "published"
  | "pending"
  | "error";

export function StatusBadge({
  status,
  children,
  className,
}: {
  status: BadgeStatus;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("status-badge", `status-${status}`, className)}>
      {children}
    </span>
  );
}
