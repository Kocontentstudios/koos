// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

const { buildBriefReadPrompt, readBriefWithModel, settleBriefRead } =
  await import("./brief-read");
const { isBriefReadCall } = await import("./fixtures");

const BRIEF =
  "Launch our new cold brew. Served over ice, ₦2,500 a bottle, from Friday. Tasting with barista Tunde Bakare.";

beforeEach(() => {
  generateObject.mockReset();
});

describe("readBriefWithModel", () => {
  it("asks once, with the brief, and returns the answer", async () => {
    generateObject.mockResolvedValue({
      object: {
        facts: [{ kind: "price", text: "₦2,500" }],
        offering: { kind: "product", phrase: "cold brew" },
        people: ["Tunde Bakare"],
      },
    });
    const raw = await readBriefWithModel({ briefText: BRIEF, title: "" });
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(isBriefReadCall(generateObject.mock.calls[0][0])).toBe(true);
    expect(generateObject.mock.calls[0][0].prompt).toContain(BRIEF);
    expect(raw?.facts).toEqual([{ kind: "price", text: "₦2,500" }]);
  });

  it("asks again once, then reports itself unavailable", async () => {
    generateObject.mockRejectedValue(new Error("throttled"));
    expect(
      await readBriefWithModel({ briefText: BRIEF, title: "" }),
    ).toBeNull();
    expect(generateObject).toHaveBeenCalledTimes(2);
  });

  it("is unavailable when the answer has no facts list", async () => {
    generateObject.mockResolvedValue({ object: { directions: [] } });
    expect(
      await readBriefWithModel({ briefText: BRIEF, title: "" }),
    ).toBeNull();
  });

  it("tells the reader the shapes the hand parsers broke on", () => {
    const prompt = buildBriefReadPrompt({ briefText: BRIEF, title: "Cold" });
    expect(prompt).toContain("for a set of four");
    expect(prompt).toContain("ending before any day or time that follows it");
    expect(prompt).toContain("never include an hour, count or second number");
    expect(prompt).toContain("never one word of a longer name");
  });
});

describe("settleBriefRead", () => {
  it("holds the offering and the people to the brief's words", () => {
    const read = settleBriefRead(
      {
        facts: [
          { kind: "price", text: "₦2,500" },
          { kind: "day", text: "from Friday" },
          { kind: "offer", text: "cold brew" },
        ],
        offering: { kind: "product", phrase: "Cold Brew" },
        people: ["Tunde Bakare", "Ada Obi"],
      },
      BRIEF,
      "NG",
    );
    expect(read.available).toBe(true);
    expect(read.offering).toEqual({ kind: "product", phrase: "cold brew" });
    expect(read.people).toEqual(["Tunde Bakare"]);
    expect(read.facts.map((f) => f.text)).toEqual([
      "₦2,500 a bottle",
      "From Friday",
    ]);
    expect(read.dropped).toEqual([
      { text: "Ada Obi", why: "person not in the brief" },
      { text: "cold brew", why: "the product itself, not a fact about it" },
    ]);
  });

  /* Round-3 code critic: "WhatsApp" and "shop" resolved as products. */
  it("refuses a channel, a shop or a phrase not in the brief as the offering", () => {
    for (const phrase of ["WhatsApp", "our shop", "iced coffee"]) {
      const read = settleBriefRead(
        { facts: [], offering: { kind: "product", phrase }, people: [] },
        "Order on WhatsApp from our shop: new cold brew.",
        "NG",
      );
      expect(read.offering).toBeNull();
    }
  });

  it("is unavailable, with nothing read, when the reader was not reached", () => {
    expect(settleBriefRead(null, BRIEF, "NG")).toEqual({
      available: false,
      facts: [],
      offering: null,
      people: [],
      dropped: [],
    });
  });
});
