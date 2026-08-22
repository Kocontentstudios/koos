import { redirect } from "next/navigation";
import { redirectToLogin } from "@/lib/auth/redirects";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import { hasCompletedBrand } from "@/lib/brand-profile";
import { getActiveBrandForMember } from "@/lib/db/queries";

export async function requireBrand() {
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser) redirectToLogin();
  const brand = await getActiveBrandForMember(workspace.id, dbUser.id);
  if (!hasCompletedBrand(brand?.onboardingStatus)) {
    /* Only offer brand creation to someone allowed to create one. A
       brand-scoped member with no assignments would otherwise be bounced to
       a page they are forbidden from, with no way out. */
    redirect(can(role, "create_brand") ? "/brand/create" : "/no-brands");
  }
  return { dbUser, workspace, role, brand };
}
