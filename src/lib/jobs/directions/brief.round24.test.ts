// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

const { applyFits, fitRequests } = await import("./brief");
const { factLedger } = await import("./claims");
const { briefCallToAction, buttonLeftOff } = await import("./finalize");
const { draftOf } = await import("./fixtures");

/*
 * Round-23 live run, storefront s1: delivered with no button for a brief
 * that ends "Call 0815 220 9031 to order.", recorded only as one copy
 * fallback. A direction for a brief that asks the customer to act is asked
 * for a button when it has none, and a design that still carries none
 * says why.
 */
const STOREFRONT =
  "We reopen on Saturday 12 December after a full refit. Hand-tied bouquets from ₦18,000 each, with same-day delivery across Lekki. Open daily 9am to 7pm at 22 Admiralty Way, Lekki Phase 1. Call 0815 220 9031 to order.";
const checks = {
  ledger: factLedger([STOREFRONT]),
  briefText: STOREFRONT,
  title: "Reopening",
};

describe("round 24: a brief's call to action", () => {
  it("is the brief's first sentence that is an action the customer takes", () => {
    expect(briefCallToAction(STOREFRONT)).toBe("Call 0815 220 9031 to order.");
    expect(
      briefCallToAction(
        "Our cold brew flight is on: three tasters for ₦6,000. Ask for oat milk.",
      ),
    ).toBe("Ask for oat milk.");
    expect(
      briefCallToAction("A new strawberry slice, ₦4,500, from Monday."),
    ).toBeNull();
  });

  it("asks for a button when a direction has none", () => {
    const requests = fitRequests([draftOf({ cta: undefined })], checks);
    expect(requests).toContainEqual(
      expect.objectContaining({
        id: "0.cta",
        field: "button",
        text: "",
        problems: [
          expect.stringContaining(
            'the brief asks the customer to act ("Call 0815 220 9031 to order.")',
          ),
        ],
      }),
    );
  });

  it("asks nothing of a direction that has one, or of a brief that asks no action", () => {
    expect(
      fitRequests([draftOf({ cta: "Call to Order" })], checks).filter(
        (r) => r.id === "0.cta",
      ),
    ).toEqual([]);
    const quiet = {
      ...checks,
      briefText: "A new strawberry slice, ₦4,500, from Monday.",
    };
    expect(
      fitRequests([draftOf({ cta: undefined })], quiet).filter(
        (r) => r.id === "0.cta",
      ),
    ).toEqual([]);
  });

  it("takes the model's button when it is an action that fits, never one that is not", () => {
    const draft = draftOf({ cta: undefined });
    const requests = fitRequests([draft], checks);
    const taken = applyFits(
      [draft],
      requests,
      [{ id: "0.cta", text: "Call to Order" }],
      checks,
    );
    expect(taken.drafts[0].cta).toBe("Call to Order");
    const refused = applyFits(
      [draft],
      requests,
      [{ id: "0.cta", text: "Same-day delivery" }],
      checks,
    );
    expect(refused.drafts[0].cta).toBeUndefined();
  });

  it("says why a design carries no button", () => {
    expect(buttonLeftOff({ copyFallbacks: [] }, checks)).toEqual({
      button: null,
      why: "the model wrote none, and the button it was asked for could not be drawn",
    });
    expect(
      buttonLeftOff(
        {
          copyFallbacks: [
            { field: "cta", from: "Same-day delivery", to: null },
          ],
        },
        checks,
      ),
    ).toEqual({
      button: "Same-day delivery",
      why: '"Same-day delivery" is not an action the customer takes',
    });
    expect(
      buttonLeftOff(
        {
          copyFallbacks: [
            {
              field: "cta",
              from: "Call to order your hand-tied bouquet now",
              to: null,
            },
          ],
        },
        checks,
      ).why,
    ).toMatch(/characters, limit/);
  });
});
