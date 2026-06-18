"use server";

import { revalidatePath } from "next/cache";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  createBrand,
  getActiveBrandForUser,
  updateBrand,
} from "@/lib/db/queries";
import { brandProfileSchema } from "./brand-profile-form";

export async function saveBrandProfile(
  raw: unknown,
): Promise<{ ok: true; brandId: string } | { ok: false; error: string }> {
  const { dbUser } = await getAuthUser();
  if (!dbUser) return { ok: false, error: "Not authenticated" };

  const parsed = brandProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }
  const v = parsed.data;
  const profile = {
    name: v.name,
    overview: v.overview,
    businessType: v.businessType,
    stage: v.stage,
    targetAudience: v.targetAudience || undefined,
    offer: v.offer || undefined,
    tone: v.tone || undefined,
    primaryGoal: v.primaryGoal || undefined,
    primaryColor: v.primaryColor || undefined,
    secondaryColor: v.secondaryColor || undefined,
    additionalColors: v.additionalColors ?? undefined,
    logoUrl: v.logoUrl || undefined,
    onboardingStatus: "completed" as const,
    completionPercentage: 100,
  };

  const existing = await getActiveBrandForUser(dbUser.id);
  const brand =
    existing && existing.onboardingStatus !== "completed"
      ? await updateBrand(existing.id, profile)
      : await createBrand({ userId: dbUser.id, ...profile });

  if (!brand) return { ok: false, error: "Failed to save" };

  revalidatePath("/brand");
  revalidatePath("/dashboard");
  return { ok: true, brandId: brand.id };
}
