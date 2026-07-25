"use server";

import { getActiveWorkspace } from "@/lib/auth/workspace";
import { createBrand, getActiveBrandForMember } from "@/lib/db/queries";

/**
 * Resolve the brand a quick request attaches to. design_tickets.brandId is
 * NOT NULL and no brand row exists until the full onboarding form is
 * submitted, so a user with no brand gets a minimal draft row here.
 *
 * The draft stays invisible to the dashboard: requireBrand gates on
 * onboardingStatus === "completed". saveBrandProfile later takes its
 * `existing` branch and upgrades this same row in place.
 */
export async function ensureQuickRequestBrand(
  businessName: string,
): Promise<{ ok: true; brandId: string } | { ok: false; error: string }> {
  const { dbUser, workspace } = await getActiveWorkspace();
  if (!dbUser || !workspace) return { ok: false, error: "Not authenticated" };

  const name = businessName.trim();
  if (!name) return { ok: false, error: "Enter your business name" };

  const existing = await getActiveBrandForMember(workspace.id, dbUser.id);
  if (existing) return { ok: true, brandId: existing.id };

  const brand = await createBrand({
    userId: dbUser.id,
    workspaceId: workspace.id,
    name,
    onboardingStatus: "draft",
    completionPercentage: 0,
  });
  if (!brand) return { ok: false, error: "Could not start your request" };
  return { ok: true, brandId: brand.id };
}
