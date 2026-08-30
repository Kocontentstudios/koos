import { describe, expect, it } from "vitest";
import type { ChatBrandContext } from "@/lib/ai/prompts/chat";
import { buildOnboardingPrompt } from "@/lib/ai/prompts/onboarding";
import {
  type ChipPrompt,
  detectChipPrompt,
  pollMarker,
} from "@/lib/onboarding/chips";

/**
 * The prompt and the client agree on one thing: a marker. This pins that
 * agreement, because nothing else links them — the prompt is prose the model
 * reads, and `chips.ts` is a parser. If the prompt stops teaching a marker, or
 * teaches one the parser does not know, the poll silently stops appearing and
 * the conversation still looks fine.
 */
const KINDS: ChipPrompt[] = [
  "tone",
  "avoid",
  "differentiation",
  "competitor-strengths",
];

const EMPTY_CONTEXT: ChatBrandContext = {
  brandProfile: "",
  audience: "",
  brandVoice: "",
  existingCampaigns: "",
  previousConversations: "",
};

const prompt = buildOnboardingPrompt(EMPTY_CONTEXT);

describe("the onboarding prompt and the chip parser agree", () => {
  it.each(KINDS)("the prompt teaches the %s marker verbatim", (kind) => {
    expect(prompt).toContain(pollMarker(kind));
  });

  it.each(KINDS)("a message carrying the %s marker parses back", (kind) => {
    expect(detectChipPrompt(`Some question? ${pollMarker(kind)}`)).toBe(kind);
  });

  /* Asserting each marker appears SOMEWHERE is half a guard: swapping the two
     competitor markers between the topic lines leaves that green while
     producing exactly the column inversion this whole design exists to
     prevent. The binding is per line. */
  it.each([
    [/topic 8[^\n]*\bTHIS brand\b/i, "differentiation"],
    [/topic 9[^\n]*\bCOMPETITORS\b/i, "competitor-strengths"],
    [/topic 4[^\n]*tone/i, "tone"],
    [/topic 5[^\n]*avoid/i, "avoid"],
  ] as const)("the %s line carries the %s marker", (topicLine, kind) => {
    const line = prompt.split("\n").find((l) => topicLine.test(l));
    expect(line).toBeDefined();
    expect(line).toContain(pollMarker(kind as ChipPrompt));
  });

  /* The ticket's headline requirement — "go beyond asking competitor names" —
     lives entirely in these three lines, and the Guidelines block below
     references topics 8 and 9 by number. */
  it("asks competitors, our difference and their strengths as three topics", () => {
    expect(prompt).toMatch(/^7\. Competitors — who else is in the space/m);
    expect(prompt).toMatch(/^8\. What this brand does differently or better/m);
    expect(prompt).toMatch(
      /^9\. What those competitors are genuinely good at/m,
    );
  });

  it("teaches no marker the parser would not recognise", () => {
    const taught = [...prompt.matchAll(/\[\[poll:([a-z-]+)\]\]/gi)].map(
      (m) => m[1],
    );
    expect(taught.length).toBeGreaterThanOrEqual(KINDS.length);
    for (const marker of taught) {
      expect(detectChipPrompt(`Q? [[poll:${marker}]]`)).not.toBeNull();
    }
  });

  it("says the marker is stripped, so the model does not apologise for it", () => {
    expect(prompt).toMatch(/stripped before the user sees it/i);
  });

  /* The pair is the reason the marker exists; the prompt has to say so, or a
     later edit will "simplify" it away. */
  it("explains that wording alone cannot separate topics 8 and 9", () => {
    expect(prompt).toMatch(/mirror images/i);
  });

  it("keeps the competitor-names topic marker-free", () => {
    expect(prompt).toMatch(/Topic 7 is names only: no suggestions, no marker/i);
  });

  /* Tone and avoid keep a prose fallback because their vocabulary is narrow
     and they shipped on it; these are the phrasings the prompt asks for. */
  describe("the tone and avoid fallbacks still cover the prompt's wording", () => {
    it.each([
      "What tone should the brand have?",
      "How would you describe your brand's voice?",
      "What personality are you going for?",
    ])("%j still shows tone chips unmarked", (text) => {
      expect(detectChipPrompt(text)).toBe("tone");
    });

    it.each([
      "Are there words or phrases you'd avoid?",
      "Any language you never want associated with the brand?",
    ])("%j still shows avoid chips unmarked", (text) => {
      expect(detectChipPrompt(text)).toBe("avoid");
    });
  });

  /* Every one of these used to trigger a poll. The model acknowledges the last
     answer and asks the next question in one sentence, so a bare keyword plus
     a question mark was reachable from almost any turn — and a tap injects a
     claim the user never made onto a profile they confirm without reading. */
  describe("does not fire on an unrelated turn", () => {
    it.each([
      "Got it. So you're better known locally — what's your main goal this year?",
      "Which platform works better for you, Instagram or TikTok?",
      "Is there a better time of day for you to post?",
      "Nice — that's a really unique offer, what's the price point?",
      "Who's the audience, and what makes them different from everyone else's?",
      "Great, so you want to stand out — which platforms are you on right now?",
      "Perfect — an edge like that is worth leaning on, so what's your primary goal?",
      "Do they respond better to video or to photos?",
      "Are they good at finding you organically?",
      "Sounds like your customers are ahead of the curve, are they on TikTok?",
    ])("returns null for %j", (text) => {
      expect(detectChipPrompt(text)).toBeNull();
    });
  });
});
