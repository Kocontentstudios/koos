"use server";

import { revalidatePath } from "next/cache";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import {
  PLACEHOLDER_BRAND_NAME,
  parseAdditionalColors,
} from "@/lib/brand-profile";
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

export interface VisualIdentityInput {
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  brandStyle: string;
  brandFont: string;
  brandFontUrl: string;
  additionalColors: string[];
}

/**
 * Saves the visual identity step and returns the brand as it now stands, so
 * the snapshot card that follows renders the colours and logo just captured
 * rather than the row the client fetched before this write.
 *
 * Blank fields are written as null rather than skipped: clearing a colour has
 * to be possible, and an empty string in a colour column renders as an
 * invisible swatch.
 */
export async function saveVisualIdentity(
  brandId: string,
  input: VisualIdentityInput,
): Promise<
  { ok: true; snapshot: BrandSnapshotFields } | { ok: false; error: string }
> {
  const { dbUser } = await getActiveWorkspace();
  if (!dbUser) return { ok: false, error: "Not authenticated" };

  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) return { ok: false, error: access.error };

  const sanitisedColors = parseAdditionalColors(input.additionalColors);
  const updated = await updateBrand(brandId, {
    logoUrl: input.logoUrl.trim() || null,
    hasLogo: Boolean(input.logoUrl.trim()),
    primaryColor: input.primaryColor.trim() || null,
    secondaryColor: input.secondaryColor.trim() || null,
    additionalColors: sanitisedColors.length > 0 ? sanitisedColors : null,
    brandStyle: input.brandStyle.trim() || null,
    brandFont: input.brandFont.trim() || null,
    brandFontUrl: input.brandFontUrl.trim() || null,
  });
  if (!updated) return { ok: false, error: "Could not save" };

  revalidatePath("/brand");
  revalidatePath("/dashboard");
  return { ok: true, snapshot: toBrandSnapshot(updated) };
}
