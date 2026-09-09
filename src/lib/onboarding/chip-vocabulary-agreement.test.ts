import { describe, expect, it } from "vitest";
import {
  platformOptions,
  postingFrequencyOptions,
  primaryPlatformOptions,
} from "@/app/(dashboard)/brand/brand-profile-form";
import { CADENCE_CHIPS, PLATFORM_CHIPS, PRIMARY_PLATFORM_CHIPS } from "./chips";

/**
 * The chat and the Brand Profile form write the same three columns. If they
 * offer different words, a brand set up by chat shows its answer stranded in
 * the form's "Custom" box — legible, but the two surfaces then disagree about
 * what the canonical options are. These pin them together; adding an option is
 * safe, renaming one orphans every brand already saved under it.
 */
describe("chip vocabulary agrees with the Brand Profile form", () => {
  it("offers only platforms the form also offers", () => {
    for (const chip of PLATFORM_CHIPS) {
      expect(platformOptions).toContain(chip);
    }
  });

  it("offers exactly the primary platforms the form offers", () => {
    expect([...PRIMARY_PLATFORM_CHIPS].sort()).toEqual(
      [...primaryPlatformOptions].sort(),
    );
  });

  /* Cadence is deliberately a subset: "3x / week" and "5x / week" predate the
     ticket's ranges and stay in the form so splitOther still recognises brands
     saved under them, but offering both beside "3–4x / week" is a choice
     without a difference. Naming them here means adding a NEW form option
     without deciding whether the chat should offer it fails this test. */
  const DEPRECATED_CADENCES = ["3x / week", "5x / week"];

  it("accounts for every cadence the form offers", () => {
    const accounted = [
      ...CADENCE_CHIPS,
      ...DEPRECATED_CADENCES,
      "Custom",
    ].sort();
    expect([...postingFrequencyOptions].sort()).toEqual(accounted);
  });

  /* "Other"/"Custom" are escape hatches in the form's selects; the picker has
     its own free-text input, so offering them as chips would be a dead end. */
  it("does not offer the form's escape hatches as chips", () => {
    for (const chips of [PLATFORM_CHIPS, PRIMARY_PLATFORM_CHIPS]) {
      expect(chips).not.toContain("Other");
    }
    expect(CADENCE_CHIPS).not.toContain("Custom");
  });

  it("covers every real platform the form knows about", () => {
    const real = platformOptions.filter((p) => p !== "Other");
    expect([...PLATFORM_CHIPS].sort()).toEqual([...real].sort());
  });

  it("carries the cadences the ticket named", () => {
    for (const cadence of ["1–2x / week", "3–4x / week", "Daily"]) {
      expect(CADENCE_CHIPS).toContain(cadence);
    }
  });

  it("carries the channels the ticket named", () => {
    for (const channel of [
      "Instagram",
      "LinkedIn",
      "X (Twitter)",
      "TikTok",
      "YouTube",
      "Email / Newsletter",
    ]) {
      expect(PLATFORM_CHIPS).toContain(channel);
    }
  });
});
