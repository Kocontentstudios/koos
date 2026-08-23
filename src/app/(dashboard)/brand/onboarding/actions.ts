"use server";

import { revalidatePath } from "next/cache";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import { PLACEHOLDER_BRAND_NAME } from "@/lib/brand-profile";
import { createBrand, getActiveBrandForMember } from "@/lib/db/queries";

/**
 * Conversational onboarding needs a brandId before the first message: both
 * /api/chat and /api/brand/onboarding/extract key off it. A brand-new user has
 * no brand row, so this mints a draft one.
 *
 * Deliberately a server action rather than a write inside the page render.
 * The sidebar links to /brand/onboarding, and Next prefetches that route on
 * hover, so a render-time insert would create throwaway brands for users who
 * never clicked.
 */
export async function startConversationalOnboarding(): Promise<
  { ok: true; brandId: string } | { ok: false; error: string }
> {
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser || !workspace) return { ok: false, error: "Not authenticated" };

  const existing = await getActiveBrandForMember(workspace.id, dbUser.id);
  if (existing) return { ok: true, brandId: existing.id };

  /* Same capability gate as /brand/create: a server action is a reachable
     POST endpoint, and this creates a real brand row. */
  if (!can(role, "create_brand")) {
    return {
      ok: false,
      error: "You need workspace admin access to add a brand.",
    };
  }

  const brand = await createBrand({
    userId: dbUser.id,
    workspaceId: workspace.id,
    name: PLACEHOLDER_BRAND_NAME,
    onboardingType: "conversational",
    onboardingStatus: "draft",
    completionPercentage: 0,
  });
  if (!brand) return { ok: false, error: "Could not start onboarding" };

  revalidatePath("/brand/onboarding");
  return { ok: true, brandId: brand.id };
}
