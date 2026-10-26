// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

const { buildFooterRepeatPrompt, checkFooterRepeats, dropMarkedRepeats } =
  await import("./footer-repeats");
const { settleBriefFacts } = await import("./brief-facts");

const retreat = {
  headline: "Step away this December",
  subheadline: "A retreat outside Ibadan, 12–14 December. Free registration.",
  cta: "Register Free",
  footerLines: [
    "Friday 12 December · Sunday 14 December",
    "Free registration · stillwater.ng",
  ],
  footerStyle: "text" as const,
};

beforeEach(() => generateObject.mockReset());

describe("checkFooterRepeats", () => {
  it("asks about each footer item by id, beside the copy above it", async () => {
    generateObject.mockResolvedValue({
      object: { repeats: [{ id: "0.2", repeats: "the button" }] },
    });
    expect(await checkFooterRepeats([retreat])).toEqual([
      { id: "0.2", repeats: "the button" },
    ]);
    const prompt = buildFooterRepeatPrompt([retreat]);
    expect(prompt).toContain("footer item 0.0: Friday 12 December");
    expect(prompt).toContain("footer item 0.3: stillwater.ng");
    expect(prompt).toContain("button: Register Free");
  });

  it("ignores ids it did not ask about, and is fail-soft", async () => {
    generateObject.mockResolvedValue({
      object: { repeats: [{ id: "4.9", repeats: "x" }] },
    });
    expect(await checkFooterRepeats([retreat])).toEqual([]);
    generateObject.mockRejectedValueOnce(new Error("throttled"));
    expect(await checkFooterRepeats([retreat])).toBeNull();
  });

  it("makes no call for directions without a footer", async () => {
    expect(await checkFooterRepeats([{ ...retreat, footerLines: [] }])).toEqual(
      [],
    );
    expect(generateObject).not.toHaveBeenCalled();
  });
});

describe("dropMarkedRepeats", () => {
  const brief =
    "Weekend retreat outside Ibadan, Friday 12 December to Sunday 14 December. Free registration at stillwater.ng.";
  const facts = settleBriefFacts(
    [
      { kind: "date", text: "Friday 12 December to Sunday 14 December" },
      { kind: "price", text: "Free registration" },
      { kind: "contact", text: "stillwater.ng" },
    ],
    brief,
    { region: "NG" },
  ).facts;

  it("drops a marked item whose facts are said elsewhere, and keeps one that carries a fact", () => {
    const { directions, outcomes } = dropMarkedRepeats(
      [retreat],
      [
        { id: "0.2", repeats: "Register Free on the button" },
        { id: "0.0", repeats: "12–14 December above" },
      ],
      facts,
    );
    expect(directions[0].footerLines).toEqual([
      "Friday 12 December · Sunday 14 December",
      "stillwater.ng",
    ]);
    expect(outcomes).toEqual([
      expect.objectContaining({ item: "Free registration", dropped: true }),
      expect.objectContaining({
        item: "Friday 12 December",
        dropped: false,
        kept: "it carries a brief fact said nowhere else",
      }),
    ]);
  });
});
