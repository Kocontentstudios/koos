import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/get-user";
import { redirectToLogin } from "@/lib/auth/redirects";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { can } from "@/lib/auth/workspace-access";
import { getActiveBrandForMember } from "@/lib/db/queries";
import { evaluateWelcomeGate } from "@/lib/welcome/gate";
import { OnboardingClient } from "./onboarding-client";
import { OnboardingStart } from "./onboarding-start";

export default async function BrandOnboardingPage() {
  const { dbUser } = await getAuthUser();
  if (!dbUser) redirectToLogin();

  const { workspace, role } = await getActiveWorkspace();
  const brand = workspace
    ? await getActiveBrandForMember(workspace.id, dbUser.id)
    : null;
  // Unlike /brand, onboarding is the tool for filling in a brand that
  // doesn't exist yet or is still incomplete, so a draft is fine here. With
  // no brand row at all we offer to mint one rather than bouncing to the
  // manual form — this page is where a brand-new user is meant to land.
  const welcome = evaluateWelcomeGate({
    welcomeSeenAt: dbUser.welcomeSeenAt,
    brandOnboardingStatus: brand?.onboardingStatus,
  });

  if (!brand) {
    if (!role || !can(role, "create_brand")) redirect("/no-brands");
    return <OnboardingStart showWelcome={welcome.show} />;
  }

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
