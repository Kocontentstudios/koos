"use server";

import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
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
  const { dbUser, workspace, role } = await getActiveWorkspace();
  if (!dbUser || !workspace) return { ok: false, error: "Not authenticated" };

  const name = businessName.trim();
  if (!name) return { ok: false, error: "Enter your business name" };

  const existing = await getActiveBrandForMember(workspace.id, dbUser.id);
  if (existing) return { ok: true, brandId: existing.id };

  /* Server actions are reachable POST endpoints, so this is a real brand
     creation path and needs the same capability as /brand/create. Without it
     a contributor creates a draft brand here, then upgrades it through
     saveBrandProfile's `existing` branch — bypassing create_brand entirely. */
  if (!can(role, "create_brand")) {
    return {
      ok: false,
      error: "You need workspace admin access to add a brand.",
    };
  }

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
