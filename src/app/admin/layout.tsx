import Link from "next/link";
import { requireRole } from "@/lib/auth/require-role";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { dbUser } = await requireRole(["designer", "admin"]);
  const isAdmin = dbUser.role === "admin";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[var(--border)] bg-background/80 px-6 backdrop-blur-xl">
        <div className="flex items-center gap-6">
          <Link
            href="/admin"
            className="font-display text-lg font-bold text-foreground"
          >
            KO Design Admin
          </Link>
          <nav className="flex items-center gap-4 text-[13px] text-[var(--text-secondary)]">
            <Link href="/admin" className="hover:text-foreground">
              Dashboard
            </Link>
            <Link href="/admin/tickets" className="hover:text-foreground">
              Queue
            </Link>
            {isAdmin && (
              <>
                <Link href="/admin/brands" className="hover:text-foreground">
                  Brands
                </Link>
                <Link href="/admin/users" className="hover:text-foreground">
                  Users
                </Link>
                <Link href="/admin/settings" className="hover:text-foreground">
                  Settings
                </Link>
              </>
            )}
          </nav>
        </div>
        <Link
          href="/dashboard"
          className="text-[13px] text-[var(--text-secondary)] hover:text-foreground"
        >
          Back to app
        </Link>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
