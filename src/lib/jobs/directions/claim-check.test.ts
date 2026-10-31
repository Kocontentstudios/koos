// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

const { buildClaimCheckPrompt, checkClaims } = await import("./claim-check");

const input = {
  fields: [
    {
      id: "0.headline",
      field: "headline",
      text: "Still warm at 7am",
      limit: 70,
    },
    { id: "0.cta", field: "button", text: "[REGISTRATION LINK]", limit: 32 },
  ],
  briefText:
    "Launch our new strawberry mille-feuille, ₦4,500 a slice, available from Monday. Pickup from 7am.",
  title: "Strawberry mille-feuille launch",
  brand: {
    name: "Crumb & Co.",
    overview: "Neighbourhood bakery in Lekki, Lagos",
    tone: "Warm, unfussy",
  },
};

beforeEach(() => generateObject.mockReset());

describe("checkClaims", () => {
  it("asks once with the brief, the profile's facts and every field", async () => {
    generateObject.mockResolvedValue({ object: { unsupported: [] } });
    expect(await checkClaims(input)).toEqual([]);
    expect(generateObject).toHaveBeenCalledTimes(1);
    const prompt = buildClaimCheckPrompt(input);
    expect(prompt).toContain(input.briefText);
    expect(prompt).toContain("0.headline | headline | Still warm at 7am");
    /* The voice is not a fact: "Warm, unfussy" must not license "warm". */
    expect(prompt).not.toContain("Warm, unfussy");
    expect(prompt).toMatch(/not written in English/);
  });

  /* Round-6 eval, run a: the judge flagged "hand-woven" on a brief that says
     "woven by one artisan", "Build Africa's Payments Future" on a launch
     brief, and "architect Ada Obi on Building for Heat" on a brief that
     names the panel. */
  it("names near-synonym method claims, added scale and added roles or topics", () => {
    const prompt = buildClaimCheckPrompt(input);
    expect(prompt).toMatch(/"woven by hand" for "woven by one artisan"/);
    expect(prompt).toMatch(/a near-synonym is a different claim/);
    expect(prompt).toMatch(/scale, reach or ambition/);
    expect(prompt).toMatch(/"Africa's payments future"/);
    expect(prompt).toMatch(/role, title or topic added to a person/);
    /* Round 7: the examples made the check flag the brief's own words. */
    expect(prompt).toMatch(/anything the brief itself says in the same words/);
    expect(prompt).not.toMatch(/"architect Ada Obi" when/);
  });

  it("returns what it flags, for fields it was asked about only", async () => {
    generateObject.mockResolvedValue({
      object: {
        unsupported: [
          {
            id: "0.headline",
            statement: "Still warm",
            rewrite: "Ready at 7am",
          },
          { id: "9.headline", statement: "made up", rewrite: "" },
        ],
      },
    });
    expect(await checkClaims(input)).toEqual([
      { id: "0.headline", statement: "Still warm", rewrite: "Ready at 7am" },
    ]);
  });

  it("is unavailable, not empty, when the call fails", async () => {
    generateObject.mockRejectedValueOnce(new Error("throttled"));
    expect(await checkClaims(input)).toBeNull();
  });

  it("makes no call with nothing to read", async () => {
    expect(await checkClaims({ ...input, fields: [] })).toEqual([]);
    expect(generateObject).not.toHaveBeenCalled();
  });
});
