"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ROLES, type Role } from "@/lib/auth/roles";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export function UsersTable({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function changeRole(userId: string, role: Role) {
    setPendingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Could not update role");
      }
      toast.success("Role updated");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update role");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)]">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-1 text-[12px] uppercase tracking-wider text-[var(--text-muted)]">
          <tr>
            <th className="px-4 py-3 font-semibold">Name</th>
            <th className="px-4 py-3 font-semibold">Email</th>
            <th className="px-4 py-3 font-semibold">Role</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isSelf = u.id === currentUserId;
            return (
              <tr
                key={u.id}
                className="border-t border-[var(--border)] text-foreground"
              >
                <td className="px-4 py-3">{u.name || "—"}</td>
                <td className="px-4 py-3 text-[var(--text-secondary)]">
                  {u.email}
                </td>
                <td className="px-4 py-3">
                  <select
                    aria-label={`Role for ${u.email}`}
                    className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none disabled:opacity-50"
                    value={u.role}
                    disabled={pendingId === u.id || isSelf}
                    title={
                      isSelf ? "You can't change your own role" : undefined
                    }
                    onChange={(e) => changeRole(u.id, e.target.value as Role)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
