import { describe, expect, it } from "vitest";
import { speechText } from "@/lib/speech/speech-text";

describe("speechText", () => {
  describe("emoji", () => {
    it("drops emoji rather than letting them be announced by name", () => {
      expect(speechText("Great work! 🎉 Let's keep going 🚀")).toBe(
        "Great work! Let's keep going",
      );
    });

    it("drops emoji that carry a skin-tone modifier", () => {
      expect(speechText("Nice one 👍🏽 thanks")).toBe("Nice one thanks");
    });

    it("drops multi-codepoint ZWJ sequences whole", () => {
      expect(speechText("Team 👨‍👩‍👧‍👦 ready")).toBe("Team ready");
    });

    it("drops flags", () => {
      expect(speechText("Launching in 🇳🇬 next week")).toBe(
        "Launching in next week",
      );
    });

    it("keeps ordinary punctuation and accented letters", () => {
      expect(speechText("Café — naïve, résumé: 50% off!")).toBe(
        "Café — naïve, résumé: 50% off!",
      );
    });
  });

  describe("markdown", () => {
    it("unwraps bold, italic and bold-italic", () => {
      expect(speechText("**bold** and *italic* and ***both***")).toBe(
        "bold and italic and both",
      );
      expect(speechText("__bold__ and _italic_")).toBe("bold and italic");
    });

    it("unwraps strikethrough", () => {
      expect(speechText("~~gone~~ stays")).toBe("gone stays");
    });

    it("strips heading markers but keeps the heading text", () => {
      expect(speechText("## Brand Voice\nWarm and direct.")).toBe(
        "Brand Voice\nWarm and direct.",
      );
    });

    it("strips bullet and numbered list markers", () => {
      expect(speechText("- one\n- two")).toBe("one\ntwo");
      expect(speechText("1. first\n2. second")).toBe("first\nsecond");
    });

    it("strips blockquote markers", () => {
      expect(speechText("> quoted line")).toBe("quoted line");
    });

    it("keeps a link's label and drops its URL", () => {
      expect(speechText("See [the brief](https://example.com/a/b) now")).toBe(
        "See the brief now",
      );
    });

    it("keeps an image's alt text without leaving a stray bang", () => {
      expect(speechText("![a logo](https://example.com/l.png)")).toBe("a logo");
    });

    it("drops bare URLs, which are noise when spoken", () => {
      expect(speechText("Go to https://example.com/x now")).toBe("Go to now");
      expect(speechText("Go to <https://example.com/x> now")).toBe("Go to now");
    });

    it("unwraps inline code and removes fenced blocks entirely", () => {
      expect(speechText("Use `npm run dev` today")).toBe(
        "Use npm run dev today",
      );
      expect(speechText("Before\n```js\nconst a = 1;\n```\nAfter")).toBe(
        "Before\nAfter",
      );
    });

    it("removes horizontal rules without reading them as bullets", () => {
      expect(speechText("One\n\n---\n\nTwo")).toBe("One\nTwo");
    });

    it("removes table pipes", () => {
      expect(speechText("| Name | Tone |")).toBe("Name Tone");
    });
  });

  describe("whitespace", () => {
    it("collapses runs of spaces left behind by substitutions", () => {
      expect(speechText("a 🎉 🎉 b")).toBe("a b");
    });

    it("keeps a single line break between paragraphs as a pause", () => {
      expect(speechText("First para.\n\n\nSecond para.")).toBe(
        "First para.\nSecond para.",
      );
    });

    it("trims and tolerates an empty string", () => {
      expect(speechText("   ")).toBe("");
      expect(speechText("")).toBe("");
    });
  });

  it("handles a realistic assistant reply end to end", () => {
    const reply = [
      "## Got it! 🎯",
      "",
      "Here's what I captured for **Acme Coffee**:",
      "",
      "- Tone: *warm, direct* ☕",
      "- Audience: [young professionals](https://example.com/seg)",
      "",
      "Ready to keep going? 🚀",
    ].join("\n");

    expect(speechText(reply)).toBe(
      [
        "Got it!",
        "Here's what I captured for Acme Coffee:",
        "Tone: warm, direct",
        "Audience: young professionals",
        "Ready to keep going?",
      ].join("\n"),
    );
  });
});
