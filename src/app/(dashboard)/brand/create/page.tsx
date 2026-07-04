import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/get-user";
import { getActiveBrandForUser } from "@/lib/db/queries";
import { brandToFormState } from "./brand-to-form-state";
import { CreateBrandForm } from "./create-brand-form";

export default async function CreateBrandPage() {
  const { dbUser } = await getAuthUser();
  if (!dbUser) redirect("/login");

  const existing = await getActiveBrandForUser(dbUser.id);
  const initialBrand = existing ? brandToFormState(existing) : null;

  return <CreateBrandForm initialBrand={initialBrand} />;
}
