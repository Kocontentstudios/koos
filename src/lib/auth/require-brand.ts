import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/get-user";
import { hasCompletedBrand } from "@/lib/brand-profile";
import { getActiveBrandForUser } from "@/lib/db/queries";

export async function requireBrand() {
  const { dbUser } = await getAuthUser();
  if (!dbUser) redirect("/login");
  const brand = await getActiveBrandForUser(dbUser.id);
  if (!hasCompletedBrand(brand?.onboardingStatus)) redirect("/brand/create");
  return { dbUser, brand };
}
