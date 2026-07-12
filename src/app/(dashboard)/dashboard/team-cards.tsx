import { Users } from "lucide-react";
import Link from "next/link";

/** Prototype "Dashboard - Invite Card": shown while the workspace has no
 * teammates; swapped for TeamOverviewCard once it does. */
export function InviteTeamCard() {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-gradient-to-r from-primary/10 to-[#7c5cff]/10 p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Users size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Invite Your Team</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Bring teammates into this workspace to manage brands, campaigns, and
            design requests together.
          </p>
          <Link
            href="/team"
            className="mt-3 inline-block rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground"
          >
            Invite Team
          </Link>
        </div>
      </div>
    </div>
  );
}

export function TeamOverviewCard({
  memberCount,
  pendingCount,
  names,
}: {
  memberCount: number;
  pendingCount: number;
  names: string[];
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-surface-1 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Team</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {memberCount} member{memberCount === 1 ? "" : "s"}
            {pendingCount > 0 && ` · ${pendingCount} pending`}
          </p>
        </div>
        {/* Avatar stack (overlapping circles), per the prototype */}
        <div className="flex -space-x-2">
          {names.slice(0, 4).map((n) => (
            <div
              key={n}
              title={n}
              className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[var(--border)] bg-gradient-to-br from-[#e8a0b0] to-[#7c5cff] text-[10px] font-semibold text-white"
            >
              {n
                .split(" ")
                .filter(Boolean)
                .map((p) => p[0])
                .slice(0, 2)
                .join("")}
            </div>
          ))}
        </div>
      </div>
      <Link
        href="/team"
        className="mt-3 inline-block text-xs font-medium text-primary hover:underline"
      >
        Manage team →
      </Link>
    </div>
  );
}
