import { Store } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TopHeader } from "@/components/layout/top-header";
import { getAuthUser } from "@/lib/auth/get-user";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { dbUser } = await getAuthUser();

  if (!dbUser) {
    redirect("/login");
  }

  const user = {
    firstName: dbUser.firstName,
    lastName: dbUser.lastName,
    email: dbUser.email,
    avatarUrl: dbUser.avatarUrl,
  };

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar user={user} />
      <div className="ml-[240px] flex min-h-screen flex-1 flex-col">
        <TopHeader user={user}>
          <Link
            href="/brand/create"
            className="flex items-center gap-2 rounded-lg border border-primary px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <Store size={16} />
            Create Brand
          </Link>
        </TopHeader>
        <main className="flex-1 overflow-y-auto px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
