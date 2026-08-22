import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { redirectToLogin } from "@/lib/auth/redirects";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";

/**
 * Where a member lands when their workspace has nothing they can reach — a
 * brand-scoped member with no assignments, or a member of an empty workspace
 * who may not create brands. Deliberately does NOT call requireBrand(),
 * which redirects here and would loop.
 */
export default async function NoBrandsPage() {
  const { dbUser, role } = await getActiveWorkspace();
  if (!dbUser) redirectToLogin();
  // Anyone who can create a brand belongs on the create screen instead.
  if (can(role, "create_brand")) redirect("/brand/create");

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-xl font-semibold">No brands yet</h1>
      <p className="text-sm text-[var(--muted-foreground)]">
        You don&apos;t have access to any brands in this workspace. A workspace
        admin can assign you to one, and it will show up here.
      </p>
      <Button render={<Link href="/team" />} variant="secondary">
        View team
      </Button>
    </div>
  );
}
