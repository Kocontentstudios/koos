import { redirect } from "next/navigation";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { hasCompletedBrand } from "@/lib/brand-profile";
import { getActiveBrandForMember } from "@/lib/db/queries";

export async function requireBrand() {
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser) redirect("/login");
  const brand = await getActiveBrandForMember(workspace.id, dbUser.id);
  if (!hasCompletedBrand(brand?.onboardingStatus)) redirect("/brand/create");
  return { dbUser, workspace, role, brand };
}
