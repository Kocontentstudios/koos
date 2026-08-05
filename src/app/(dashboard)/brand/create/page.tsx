import { getAuthUser } from "@/lib/auth/get-user";
import { redirectToLogin } from "@/lib/auth/redirects";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { getActiveBrandForMember } from "@/lib/db/queries";
import { brandToFormState } from "./brand-to-form-state";
import { CreateBrandForm } from "./create-brand-form";

export default async function CreateBrandPage() {
  const { dbUser } = await getAuthUser();
  if (!dbUser) redirectToLogin();

  const { workspace } = await getActiveWorkspace();
  const existing = workspace
    ? await getActiveBrandForMember(workspace.id, dbUser.id)
    : null;
  const initialBrand = existing ? brandToFormState(existing) : null;

  return <CreateBrandForm initialBrand={initialBrand} />;
}
