import { describe, expect, it } from "vitest";
import { words } from "@/lib/ai/eval-text";
import { layoutVariety, scoreSpec } from "./benchmark-score";

const spec = (over: Record<string, unknown> = {}) =>
  ({
    headline: "Fresh pies, every Friday",
    subheadline: "Order before 6pm",
    cta: "Order now",
    layout: "hero-center",
    bodyPoints: [],
    ...over,
  }) as Parameters<typeof scoreSpec>[0];

describe("scoreSpec", () => {
  /* A thumbnail headline the length of a poster's is unreadable at the size it
     will actually be seen — the measurable half of "format-aware". */
  it("measures the headline against the format's budget", () => {
    const thumbnail = scoreSpec(
      spec({ headline: "One two three four five six" }),
      "Video Thumbnail",
    );

    expect(thumbnail.headlineBudget).toBe(4);
    expect(thumbnail.withinBudget).toBe(false);
  });

  it("passes a headline inside the budget", () => {
    expect(
      scoreSpec(spec({ headline: "Suya pie Friday" }), "Poster").withinBudget,
    ).toBe(true);
  });

  /* The missing-information rule: a fact nobody supplied becomes a visible
     placeholder, never a plausible invention. */
  it("finds placeholders where a fact was missing", () => {
    const scored = scoreSpec(
      spec({ subheadline: "Call [PHONE NUMBER] to order" }),
      "Flyer",
    );

    expect(scored.placeholders).toEqual(["[PHONE NUMBER]"]);
  });

  /* The failure the placeholder rule prevents, and the one that matters most:
     nobody notices an invented number is wrong. */
  it("flags a phone number nobody supplied", () => {
    const scored = scoreSpec(
      spec({ subheadline: "Call 0803 123 4567 to order" }),
      "Flyer",
    );

    expect(scored.suspectNumbers).toHaveLength(1);
  });

  it("does not mistake a short number for a phone number", () => {
    const scored = scoreSpec(spec({ subheadline: "Open until 6pm" }), "Flyer");

    expect(scored.suspectNumbers).toEqual([]);
  });

  /* The scorer read only headline/subheadline/cta and reported "0
     placeholders" for a spec carrying four of them in bodyPoints — a
     benchmark that under-reports its own result is a broken instrument. */
  it("reads every copy field, not just the headline block", () => {
    const scored = scoreSpec(
      spec({
        bodyPoints: ["[EVENT DATE] · [EVENT TIME]", "[VENUE NAME], Lagos"],
      }),
      "Flyer",
    );

    expect(scored.placeholders).toHaveLength(3);
  });

  it("finds an invented number wherever it was written", () => {
    const scored = scoreSpec(
      spec({ bodyPoints: ["Call 0803 123 4567"] }),
      "Flyer",
    );

    expect(scored.suspectNumbers).toHaveLength(1);
  });

  it("counts an empty headline as no words rather than one", () => {
    expect(words("   ")).toBe(0);
  });
});

describe("layoutVariety", () => {
  /* One layout across five different briefs is the rut the anti-repetition
     rule exists to break, and the number the benchmark can show moving. */
  it("counts distinct layouts across a run", () => {
    const scores = ["hero-center", "hero-center", "split-left"].map((layout) =>
      scoreSpec(spec({ layout }), "Flyer"),
    );

    expect(layoutVariety(scores)).toBe(2);
  });

  it("ignores specs that named no layout", () => {
    const scores = [scoreSpec(spec({ layout: "" }), "Flyer")];

    expect(layoutVariety(scores)).toBe(0);
  });
});
