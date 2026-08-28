"use server";

import { revalidatePath } from "next/cache";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { getAnalyticsSessionId } from "@/lib/analytics/session-id";
import { redirectToLogin } from "@/lib/auth/redirects";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import { brandProfileCompletion } from "@/lib/brand-profile";
import {
  type BrandSnapshotFields,
  toBrandSnapshot,
} from "@/lib/brand-snapshot";
import {
  checkBrandAccess,
  createBrand,
  getActiveBrandForMember,
  updateBrand,
} from "@/lib/db/queries";
import type { brands } from "@/lib/db/schema";
import { brandProfileSchema } from "./brand-profile-form";

export async function saveBrandProfile(
  raw: unknown,
): Promise<
  | { ok: true; brandId: string; snapshot: BrandSnapshotFields }
  | { ok: false; error: string }
> {
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser) return { ok: false, error: "Not authenticated" };
  if (!workspace) redirectToLogin();

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
    /* Empty means "no extra colours", same as platforms below. Writing {}
       would leave a brand that never had extras looking different in the DB
       from one that never touched the field. */
    additionalColors:
      v.additionalColors && v.additionalColors.length > 0
        ? v.additionalColors
        : null,
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
  };

  /* Was hardcoded to 100, so a brand that skipped every optional step still
     reported a finished profile in the admin directory. The status stays
     "completed" — the form validates all four required Basics fields before it
     will submit, and requireBrand gates on that, not on the score. */
  const completionPercentage = brandProfileCompletion(profile);

  const existing = await getActiveBrandForMember(workspace.id, dbUser.id);
  let brand: typeof brands.$inferSelect;
  if (existing) {
    /* getActiveBrandForMember already scoped the fetch, but authorize the
       WRITE explicitly rather than inferring it from the read: the roles that
       may see a brand and the roles that may edit it are no longer the same
       set, and this action must not silently widen when that changes. */
    const access = await checkBrandAccess(
      dbUser.id,
      existing.id,
      "manage_content",
    );
    if (!access.ok) return { ok: false, error: access.error };
    brand = await updateBrand(existing.id, {
      ...profile,
      completionPercentage,
    });
  } else {
    if (!can(role, "create_brand")) {
      return {
        ok: false,
        error: "You need workspace admin access to add a brand.",
      };
    }
    brand = await createBrand({
      userId: dbUser.id, // attribution only ("created by")
      workspaceId: workspace.id,
      ...profile,
      completionPercentage,
    });
  }

  if (!brand) return { ok: false, error: "Failed to save" };

  // First transition into "completed" = the user finished their Brand Brain.
  if (existing?.onboardingStatus !== "completed") {
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
  return { ok: true, brandId: brand.id, snapshot: toBrandSnapshot(brand) };
}
