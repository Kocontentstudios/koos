import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/get-user";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { getActiveBrandForMember } from "@/lib/db/queries";
import { OnboardingClient } from "./onboarding-client";

export default async function BrandOnboardingPage() {
  const { dbUser } = await getAuthUser();
  if (!dbUser) redirect("/login");

  const { workspace } = await getActiveWorkspace();
  const brand = workspace
    ? await getActiveBrandForMember(workspace.id, dbUser.id)
    : null;
  // Unlike /brand, onboarding is the tool for filling in a brand that
  // doesn't exist yet or is still incomplete — only bail when there's no
  // brand row at all, not when it's a draft.
  if (!brand) redirect("/brand/create");

  const brandContext = {
    brandProfile: [
      brand.name,
      brand.overview ?? "",
      brand.businessType ? `Business type: ${brand.businessType}` : "",
      brand.stage ? `Stage: ${brand.stage}` : "",
      brand.primaryGoal ? `Primary goal: ${brand.primaryGoal}` : "",
      brand.offer ? `Offer: ${brand.offer}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    audience: brand.targetAudience ?? "",
    brandVoice: brand.tone ?? "",
    existingCampaigns: "",
    previousConversations: "",
  };

  return <OnboardingClient brandId={brand.id} brandContext={brandContext} />;
}
