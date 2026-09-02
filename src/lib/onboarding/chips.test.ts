import { describe, expect, it } from "vitest";
import { toneBadges } from "@/lib/brand-snapshot";
import {
  COMPETITOR_STRENGTH_CHIPS,
  DIFFERENTIATION_CHIPS,
  detectChipPrompt,
  formatChipSelection,
  MAX_CHIP_SELECTION,
  pollMarker,
  stripPollMarker,
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

  /* The competitor pair is decided by the marker, never by wording. These two
     questions share every keyword and differ only in the DIRECTION of the
     comparison, and after the names topic the subject is usually a proper
     noun with no competitor token left to match. Guessing inverted the answer
     into the opposite column. */
  describe("the competitor pair is decided by the marker", () => {
    const OURS = [
      "What does your brand do differently or better than those competitors?",
      "What do you do better than your competitors?",
      "Where are you stronger than your rivals?",
      "What are you good at that they aren't?",
      "Why would someone choose you over them?",
      "What can you offer that Cocoa Bloom can't?",
      "Where do you outperform Zara Home and H&M?",
      "In what ways are you ahead of them?",
    ];
    const THEIRS = [
      "What do those competitors do better than you?",
      "What is Cocoa Bloom genuinely good at?",
      "What do Cocoa Bloom and The Skin Bar NG do well?",
      "Where are those competitors hard to beat?",
      "Honestly, where do your competitors win?",
      "What do those brands do right?",
      "Where do Zara Home and H&M have the advantage?",
      "What would you say they're known for?",
    ];

    it.each(OURS)("%j marked differentiation shows our advantages", (text) => {
      expect(detectChipPrompt(`${text} ${pollMarker("differentiation")}`)).toBe(
        "differentiation",
      );
    });

    it.each(THEIRS)("%j marked competitor-strengths shows theirs", (text) => {
      expect(
        detectChipPrompt(`${text} ${pollMarker("competitor-strengths")}`),
      ).toBe("competitor-strengths");
    });

    /* Showing nothing is safe; showing the opposite question's options writes
       the user's answer into the wrong column and then tells the strategist to
       avoid the brand's own advantage. */
    it.each([...OURS, ...THEIRS])(
      "shows nothing rather than guessing at %j",
      (text) => {
        expect(detectChipPrompt(text)).toBeNull();
      },
    );

    it("ignores a marker it does not recognise", () => {
      expect(detectChipPrompt("Anything? [[poll:market-gap]]")).toBeNull();
    });

    /* competitor-strengths is the only hyphenated kind, and snake_case is a
       routine model slip; losing the poll to a single character would be a
       silent regression with no fallback to catch it. */
    it.each([
      "[[poll:competitor_strengths]]",
      "[[poll: competitor-strengths]]",
      "[[poll:COMPETITOR-STRENGTHS]]",
      "[[poll:competitorStrengths]]",
      "[[poll:competitor-strength]]",
    ])("still reads %j as competitor-strengths", (marker) => {
      expect(detectChipPrompt(`Q? ${marker}`)).toBe("competitor-strengths");
    });

    it.each(["[[poll:differentiators]]", "[[poll:Differentiation]]"])(
      "still reads %j as differentiation",
      (marker) => {
        expect(detectChipPrompt(`Q? ${marker}`)).toBe("differentiation");
      },
    );

    /* A marker the parser does not know must not SUPPRESS the fallback that
       exists precisely to survive marker failure. */
    it("falls through to the prose fallback on a misspelled kind", () => {
      expect(detectChipPrompt("What tone should it have? [[poll:tonne]]")).toBe(
        "tone",
      );
    });

    /* A plain-object lookup would return Object.prototype.constructor here —
       truthy, so it survives `?? null` and crashes the picker on render. */
    it("does not resolve a marker to an inherited property", () => {
      for (const key of ["constructor", "toString", "valueOf"]) {
        expect(detectChipPrompt(`Q? [[poll:${key}]]`)).toBeNull();
      }
    });
  });

  /* Topic 7 asks for NAMES and carries no marker. Its answer is a list of
     proper nouns, so offering a fixed set of advantages under it is wrong. */
  describe("does not fire on the plain competitor-names question", () => {
    it.each([
      "Who else is in the space?",
      "Who are your main competitors?",
      "Which other brands are you up against?",
      "Can you name a few competitors?",
    ])("returns null for %j", (text) => {
      expect(detectChipPrompt(text)).toBeNull();
    });
  });

  /* The marker is protocol, not content: it must never reach the screen, the
     read-aloud voice, or the transcript the extractor reads. */
  describe("stripPollMarker", () => {
    it("removes the marker and the space before it", () => {
      expect(
        stripPollMarker(
          `What sets you apart? ${pollMarker("differentiation")}`,
        ),
      ).toBe("What sets you apart?");
    });

    it("leaves ordinary prose alone", () => {
      expect(stripPollMarker("What sets you apart?")).toBe(
        "What sets you apart?",
      );
    });

    /* This runs over EVERY stored chat turn in every mode, and the result is
       written to the database. Two-space list indents, four-space code blocks
       and markdown hard breaks all carry meaning, so a whitespace pass wider
       than the marker itself silently reformats strategy and design answers. */
    it.each([
      ["a nested list", "Channels:\n\n- Instagram\n  - Reels 3x/wk\n- TikTok"],
      ["an indented code block", "Run:\n\n    npm run build"],
      ["a markdown hard break", "line one  \nline two"],
      ["a blockquote", "> quoted\n>   indented"],
      ["a table", "| a  | b  |\n|----|----|"],
    ])("preserves %s untouched", (_case, text) => {
      expect(stripPollMarker(text)).toBe(text);
    });

    /* The message re-renders on every chunk and the prompt puts the marker
       last, so an arriving marker types itself out on screen. A Stop pressed
       mid-marker persists the fragment forever. */
    it.each([
      "[[",
      "[[p",
      "[[poll",
      "[[poll:",
      "[[poll:diff",
      "[[poll:differentiati",
    ])("hides the still-arriving marker %j", (partial) => {
      expect(stripPollMarker(`What do you do better?\n\n${partial}`)).toBe(
        "What do you do better?",
      );
    });

    it("removes a marker written mid-message without leaving a gap", () => {
      expect(stripPollMarker("A [[poll:tone]] B")).toBe("A B");
    });

    it("removes a leading marker and the space after it", () => {
      expect(stripPollMarker("[[poll:tone]] So what tone?")).toBe(
        "So what tone?",
      );
    });

    /* Stripping is deliberately wider than parsing: an unrecognised kind must
       still be removed, or a one-character slip leaks the raw protocol onto
       the screen ON TOP OF losing the poll. */
    it.each([
      "[[poll:market-gap]]",
      "[[poll:constructor]]",
      "[[poll:]]",
      "[[poll:competitor_strengths]]",
    ])("removes %j even though it is not a known kind", (marker) => {
      expect(stripPollMarker(`Q? ${marker}`)).toBe("Q?");
    });

    /* A delimiter is only consumed when it WRAPS the marker. Matching
       [`*_~] independently on each side ate the closing fence of a
       neighbouring code block and the trailing ** of adjacent bold — and this
       result is written to the database, so a renderer cannot undo it. */
    it.each([
      [
        "a neighbouring code fence",
        "Try:\n```\nHandwoven, always.\n```\n[[poll:differentiation]]",
        "Try:\n```\nHandwoven, always.\n```",
      ],
      ["adjacent bold", "That's **great**[[poll:tone]]", "That's **great**"],
      ["adjacent strikethrough", "~~old~~[[poll:tone]]", "~~old~~"],
      // A leading newline survives; markdown ignores it. The fence and its
      // language tag are what must not be eaten.
      ["an opening fence", "[[poll:tone]]\n```js\nx\n```", "\n```js\nx\n```"],
    ])("does not eat %s", (_case, input, expected) => {
      expect(stripPollMarker(input)).toBe(expected);
    });

    /* This runs on every message on every render and on every persisted turn.
       Three separate constructs backtracked here: a leading whitespace run
       before a required literal (200k spaces: 88s), an unbounded backtick run
       in the fence alternative (200k: 54s), and /\s+$/ against leading
       whitespace (200k: 14s). Whitespace runs on BOTH sides, because the first
       fix guarded only the trailing one and left the real cost in place. */
    it.each([
      ["trailing spaces", `Q?${" ".repeat(200_000)}`],
      ["leading spaces", `${" ".repeat(200_000)}Q?`],
      ["a backtick run", "`".repeat(200_000)],
      ["newlines", `${"\n".repeat(200_000)}Q?`],
    ])("does not backtrack on %s", (_case, input) => {
      const start = performance.now();
      stripPollMarker(input);
      expect(performance.now() - start).toBeLessThan(500);
    });

    /* Every prefix the user actually watches arrive. The ladder previously
       stopped one character short of complete, and that state — a single
       closing bracket — is the one the `]]` pattern cannot match. */
    it("hides every prefix of an arriving marker", () => {
      const full = "What sets you apart? [[poll:differentiation]]";
      for (let i = "What sets you apart?".length; i <= full.length; i += 1) {
        expect(stripPollMarker(full.slice(0, i))).toBe("What sets you apart?");
      }
    });

    /* Stripping is deliberately wider than parsing. A newline inside the
       marker parsed fine and stripped not at all — leaking in the one
       direction the invariant exists to prevent. */
    it.each([
      "[[poll:\ntone\n]]",
      "[[poll:tone\n]]",
      "[[poll:\ncompetitor-strengths]]",
    ])("strips %j even though it spans lines", (marker) => {
      expect(stripPollMarker(`Q?\n\n${marker}`)).toBe("Q?");
    });

    /* Rejoins a marker that sat flush between two words. */
    it("inserts a separator only where the marker joined two words", () => {
      expect(stripPollMarker("A[[poll:tone]]B")).toBe("A B");
      expect(stripPollMarker("A [[poll:tone]] B")).toBe("A B");
    });

    /* Backticking or bolding a token it was told to append is a routine model
       habit, and the leftovers render as an empty code span or stray asterisks. */
    it.each([
      "Q? `[[poll:tone]]`",
      "Q? **[[poll:tone]]**",
      "Q?\n```\n[[poll:tone]]\n```",
    ])("leaves no markdown residue behind %j", (text) => {
      expect(stripPollMarker(text)).toBe("Q?");
    });
  });

  /* A marker on an unrelated turn would put a poll under the wrong question,
     so it wins over the prose fallback rather than competing with it. */
  it("prefers the marker over the tone and avoid patterns", () => {
    expect(
      detectChipPrompt(`What tone should it have? ${pollMarker("avoid")}`),
    ).toBe("avoid");
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

  it("phrases a differentiation pick as the user speaking", () => {
    expect(
      formatChipSelection("differentiation", [
        "Higher quality",
        "Local expertise",
      ]),
    ).toBe(
      "What we do better than competitors: Higher quality, Local expertise.",
    );
  });

  it("phrases a competitor-strengths pick the same way", () => {
    expect(formatChipSelection("competitor-strengths", ["Bigger budget"])).toBe(
      "What our competitors are strong at: Bigger budget.",
    );
  });

  /* The extractor reads these back out of the transcript into two DIFFERENT
     columns, so the two sentences must not be confusable with each other. */
  it("keeps the two competitor sentences distinguishable", () => {
    const ours = formatChipSelection("differentiation", ["Speed"]);
    const theirs = formatChipSelection("competitor-strengths", ["Speed"]);
    expect(ours).not.toBe(theirs);
    expect(ours).toContain("we do better");
    expect(theirs).toContain("competitors are strong");
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

  it("offer the ticket's differentiation examples", () => {
    for (const word of [
      "Higher quality",
      "AI-powered speed",
      "Bespoke service",
      "Niche specialization",
    ]) {
      expect(DIFFERENTIATION_CHIPS).toContain(word);
    }
  });

  it("have no duplicates", () => {
    for (const set of [
      VOICE_TONE_CHIPS,
      WORDS_TO_AVOID_CHIPS,
      DIFFERENTIATION_CHIPS,
      COMPETITOR_STRENGTH_CHIPS,
    ]) {
      expect(new Set(set).size).toBe(set.length);
    }
  });

  /* The two competitor sets answer opposite questions; a word in both would
     make a selection ambiguous to the extractor. */
  it("keep the two competitor sets disjoint", () => {
    const overlap = DIFFERENTIATION_CHIPS.filter((chip) =>
      (COMPETITOR_STRENGTH_CHIPS as readonly string[]).includes(chip),
    );
    expect(overlap).toEqual([]);
  });
});
