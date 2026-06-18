import { requireRole } from "@/lib/auth/require-role";
import { getAllUsers } from "@/lib/db/queries";
import { UsersTable } from "./users-table";

export default async function AdminUsersPage() {
  const { dbUser } = await requireRole(["admin"]);
  const users = await getAllUsers();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">
          Users &amp; Roles
        </h1>
        <p className="mt-1 text-[14px] text-[var(--text-secondary)]">
          Grant designer or admin access. Designers can pick up the ticket
          queue; admins can also manage roles.
        </p>
      </div>
      <UsersTable
        users={users.map((u) => ({
          id: u.id,
          name: `${u.firstName} ${u.lastName}`.trim(),
          email: u.email,
          role: u.role,
        }))}
        currentUserId={dbUser.id}
      />
    </div>
  );
}
