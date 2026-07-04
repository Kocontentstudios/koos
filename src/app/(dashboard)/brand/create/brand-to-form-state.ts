import type { brands } from "@/lib/db/schema";
import {
  brandStyleOptions,
  businessTypeOptions,
  OTHER_OPTION,
  platformOptions,
  postingFrequencyOptions,
  stageOptions,
  toneOptions,
} from "../brand-profile-form";
import { type CreateBrandState, DEFAULT_STATE } from "./brand-form-state";

type Brand = typeof brands.$inferSelect;

const CUSTOM_OPTION = "Custom"; // postingFrequency's "type your own" sentinel

/**
 * Reverse a stored select value into a {value, other} pair. If the stored value
 * is a known option it is used verbatim; any other non-empty value is treated as
 * a custom entry (select set to the sentinel, text placed in `other`).
 */
function splitOther(
  stored: string | null | undefined,
  options: readonly string[],
  sentinel: string,
): { value: string; other: string } {
  const v = (stored ?? "").trim();
  if (!v) return { value: "", other: "" };
  if (options.includes(v)) return { value: v, other: "" };
  return { value: sentinel, other: v };
}

/** The six selectable platforms (the "Other" entry is not a real platform). */
const KNOWN_PLATFORMS: readonly string[] = platformOptions.filter(
  (p) => p !== "Other",
);

export function brandToFormState(brand: Brand): CreateBrandState {
  const businessType = splitOther(
    brand.businessType,
    businessTypeOptions,
    OTHER_OPTION,
  );
  const stage = splitOther(brand.stage, stageOptions, OTHER_OPTION);
  const tone = splitOther(brand.tone, toneOptions, OTHER_OPTION);
  const brandStyle = splitOther(
    brand.brandStyle,
    brandStyleOptions,
    OTHER_OPTION,
  );
  const posting = splitOther(
    brand.postingFrequency,
    postingFrequencyOptions,
    CUSTOM_OPTION,
  );

  const storedPlatforms = brand.platforms ?? [];
  const known = storedPlatforms.filter((p) => KNOWN_PLATFORMS.includes(p));
  const custom = storedPlatforms.filter((p) => !KNOWN_PLATFORMS.includes(p));
  const platforms = custom.length > 0 ? [...known, "Other"] : known;

  return {
    ...DEFAULT_STATE,
    name: brand.name ?? "",
    overview: brand.overview ?? "",
    businessType: businessType.value,
    businessTypeOther: businessType.other,
    stage: stage.value,
    stageOther: stage.other,
    targetAudience: brand.targetAudience ?? "",
    offer: brand.offer ?? "",
    tone: tone.value,
    toneOther: tone.other,
    primaryGoal: brand.primaryGoal ?? "",
    values: brand.values ?? "",
    wordsLove: brand.wordsLove ?? "",
    wordsAvoid: brand.wordsAvoid ?? "",
    hasLogo:
      brand.hasLogo === true ? "Yes" : brand.hasLogo === false ? "No" : "",
    brandStyle: brandStyle.value,
    brandStyleOther: brandStyle.other,
    primaryColor: brand.primaryColor ?? DEFAULT_STATE.primaryColor,
    secondaryColor: brand.secondaryColor ?? DEFAULT_STATE.secondaryColor,
    additionalColors: brand.additionalColors ?? [],
    logoUrl: brand.logoUrl ?? "",
    competitors: brand.competitors ?? "",
    competitorStrengths: brand.competitorStrengths ?? "",
    differentiators: brand.differentiators ?? "",
    platforms,
    platformsOther: custom.join(", "),
    primaryPlatform: brand.primaryPlatform ?? "",
    postingFrequency: posting.value,
    postingFrequencyOther: posting.other,
    additionalNotes: brand.additionalNotes ?? "",
    helpfulLinks: brand.helpfulLinks ?? "",
  };
}
