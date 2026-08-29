import { describe, expect, it } from "vitest";
import { toneBadges } from "@/lib/brand-snapshot";
import {
  detectChipPrompt,
  formatChipSelection,
  MAX_CHIP_SELECTION,
  VOICE_TONE_CHIPS,
  WORDS_TO_AVOID_CHIPS,
} from "@/lib/onboarding/chips";

describe("detectChipPrompt", () => {
  describe("tone questions", () => {
    it.each([
      "How would you describe your brand's tone?",
      "What tone of voice should the brand have?",
      "Tell me about the brand personality you're going for — what feels right?",
      "How should your brand sound to someone reading it for the first time?",
      "How do you want the brand to come across?",
    ])("matches %j", (text) => {
      expect(detectChipPrompt(text)).toBe("tone");
    });
  });

  describe("words-to-avoid questions", () => {
    it.each([
      "Are there any words to avoid?",
      "What words or phrases would you avoid?",
      "Any terms you'd never use?",
      "Is there language you want to steer clear of?",
      "What words should we avoid in your voice?",
    ])("matches %j", (text) => {
      expect(detectChipPrompt(text)).toBe("avoid");
    });

    /* "what words should we avoid in your voice?" mentions voice too, so
       avoid has to win or the wrong chips appear. */
    it("beats the tone matcher when a question is about both", () => {
      expect(
        detectChipPrompt("For your brand voice, what words should we avoid?"),
      ).toBe("avoid");
    });
  });

  /* This runs against arbitrary model prose. A false positive puts irrelevant
     chips under an unrelated question, which reads as a bug. */
  describe("does not fire on unrelated prose", () => {
    it.each([
      "Great — what's the brand called?",
      "Who are you trying to reach?",
      "That's a lovely tone of green for a skincare brand.",
      "I'll avoid asking about that again.",
      "Your audience sounds well defined.",
      "Let me know when you're ready and I'll fill in your profile.",
      "",
      "   ",
    ])("returns null for %j", (text) => {
      expect(detectChipPrompt(text)).toBeNull();
    });
  });
});

describe("formatChipSelection", () => {
  it("phrases a tone pick as the user speaking", () => {
    expect(formatChipSelection("tone", ["Bold", "Warm"])).toBe(
      "Our brand voice is: Bold, Warm.",
    );
  });

  it("phrases an avoid pick the same way", () => {
    expect(formatChipSelection("avoid", ["Synergy", "Cheap"])).toBe(
      "Words and phrases to avoid: Synergy, Cheap.",
    );
  });

  it("trims and drops blanks", () => {
    expect(formatChipSelection("tone", ["  Bold  ", "", "   ", "Warm"])).toBe(
      "Our brand voice is: Bold, Warm.",
    );
  });

  it("is empty when nothing was picked", () => {
    expect(formatChipSelection("tone", [])).toBe("");
    expect(formatChipSelection("tone", ["  "])).toBe("");
  });
});

/* The chips exist to fill `tone`, which the snapshot card renders back as
   badges. If the two disagree on format the card silently falls back to prose
   and the user's selection stops looking like a selection. */
describe("round-trip through the snapshot card", () => {
  it("renders a full selection as one badge per adjective", () => {
    const picked = ["Bold", "Warm", "Modern"];
    const message = formatChipSelection("tone", picked);
    // The extractor lifts the list out of the sentence into the tone column.
    const stored = message
      .replace("Our brand voice is: ", "")
      .replace(/\.$/, "");
    expect(toneBadges(stored)).toEqual(picked);
  });

  it("keeps every chip short enough to survive toneBadges", () => {
    for (const chip of VOICE_TONE_CHIPS) {
      expect(toneBadges(chip)).toEqual([chip]);
    }
  });

  /* toneBadges caps at 6, so allowing more would silently lose the tail. */
  it("caps selection at what the snapshot can show", () => {
    expect(MAX_CHIP_SELECTION).toBe(6);
    const six = VOICE_TONE_CHIPS.slice(0, MAX_CHIP_SELECTION);
    expect(toneBadges(six.join(", "))).toHaveLength(MAX_CHIP_SELECTION);
  });
});

describe("chip sets", () => {
  it("offer the ticket's examples", () => {
    for (const word of ["Bold", "Playful", "Authoritative", "Sophisticated"]) {
      expect(VOICE_TONE_CHIPS).toContain(word);
    }
    for (const word of ["Synergy", "Cheap", "Guaranteed", "Revolutionary"]) {
      expect(WORDS_TO_AVOID_CHIPS).toContain(word);
    }
  });

  it("have no duplicates", () => {
    expect(new Set(VOICE_TONE_CHIPS).size).toBe(VOICE_TONE_CHIPS.length);
    expect(new Set(WORDS_TO_AVOID_CHIPS).size).toBe(
      WORDS_TO_AVOID_CHIPS.length,
    );
  });
});
