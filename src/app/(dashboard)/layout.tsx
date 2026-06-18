import { Store } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TopHeader } from "@/components/layout/top-header";
import { getAuthUser } from "@/lib/auth/get-user";
import { getActiveBrandForUser } from "@/lib/db/queries";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { dbUser } = await getAuthUser();

  if (!dbUser) {
    redirect("/login");
  }

  const activeBrand = await getActiveBrandForUser(dbUser.id);

  const user = {
    firstName: dbUser.firstName,
    lastName: dbUser.lastName,
    email: dbUser.email,
    avatarUrl: dbUser.avatarUrl,
  };

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar user={user} />
      <div className="ml-[280px] flex min-h-screen flex-1 flex-col">
        <TopHeader title="Dashboard" user={user} brandName={activeBrand?.name}>
          <Link
            href="/brand/create"
            className="flex items-center gap-2 rounded-lg border border-primary px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <Store size={16} />
            Create Brand
          </Link>
        </TopHeader>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
