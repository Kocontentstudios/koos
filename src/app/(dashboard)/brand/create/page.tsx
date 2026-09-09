import { redirect } from "next/navigation";
import { redirectToLogin } from "@/lib/auth/redirects";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import { getActiveBrandForMember } from "@/lib/db/queries";
import { brandToFormState } from "./brand-to-form-state";
import { CreateBrandForm } from "./create-brand-form";

export default async function CreateBrandPage() {
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser) redirectToLogin();
  // Guarded here too, not just in the nav: the page is directly reachable.
  if (!can(role, "create_brand")) redirect("/no-brands");
  const existing = await getActiveBrandForMember(workspace.id, dbUser.id);
  const initialBrand = existing ? brandToFormState(existing) : null;

  return <CreateBrandForm initialBrand={initialBrand} />;
}
