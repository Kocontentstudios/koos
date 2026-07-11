"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { getAnalyticsSessionId } from "@/lib/analytics/session-id";
import { getAuthUser } from "@/lib/auth/get-user";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import {
  createBrand,
  getActiveBrandForMember,
  updateBrand,
} from "@/lib/db/queries";
import type { brands } from "@/lib/db/schema";
import { brandProfileSchema } from "./brand-profile-form";

export async function saveBrandProfile(
  raw: unknown,
): Promise<{ ok: true; brandId: string } | { ok: false; error: string }> {
  const { dbUser } = await getAuthUser();
  if (!dbUser) return { ok: false, error: "Not authenticated" };

  const { workspace } = await getActiveWorkspace();
  if (!workspace) redirect("/login");

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
    targetAudience: v.targetAudience || null,
    offer: v.offer || null,
    tone: v.tone || null,
    primaryGoal: v.primaryGoal || null,
    values: v.values || null,
    wordsLove: v.wordsLove || null,
    wordsAvoid: v.wordsAvoid || null,
    hasLogo: v.hasLogo ?? null,
    brandStyle: v.brandStyle || null,
    primaryColor: v.primaryColor || null,
    secondaryColor: v.secondaryColor || null,
    additionalColors: v.additionalColors ?? null,
    logoUrl: v.logoUrl || null,
    competitors: v.competitors || null,
    competitorStrengths: v.competitorStrengths || null,
    differentiators: v.differentiators || null,
    platforms: v.platforms && v.platforms.length > 0 ? v.platforms : null,
    primaryPlatform: v.primaryPlatform || null,
    postingFrequency: v.postingFrequency || null,
    additionalNotes: v.additionalNotes || null,
    helpfulLinks: v.helpfulLinks || null,
    onboardingStatus: "completed" as const,
    completionPercentage: 100,
  };

  const existing = await getActiveBrandForMember(workspace.id, dbUser.id);
  let brand: typeof brands.$inferSelect;
  if (existing) {
    brand = await updateBrand(existing.id, profile);
  } else {
    brand = await createBrand({
      userId: dbUser.id, // attribution only ("created by")
      workspaceId: workspace.id,
      ...profile,
    });
  }

  if (!brand) return { ok: false, error: "Failed to save" };

  // First transition into "completed" = the user finished their Brand Brain.
  if (!existing || existing.onboardingStatus !== "completed") {
    await captureServerEvent({
      distinctId: dbUser.id,
      event: "brand_brain_completed",
      properties: {
        brand_id: brand.id,
        session_id: await getAnalyticsSessionId(),
      },
    });
  }

  revalidatePath("/brand");
  revalidatePath("/dashboard");
  return { ok: true, brandId: brand.id };
}
