import { describe, expect, it, vi } from "vitest";
import type { DesignSpec } from "@/lib/design/spec";
import { settleDirectionLayout } from "./layout-claim";
import { LayoutsHeldError } from "./subject-layout";

const SET = "set-1";
const row = (id: string, slot: number, layout: string, status = "pending") => ({
  id,
  status,
  spec: { layout },
  rationale: { set: SET, slot },
  createdAt: new Date(),
});
const specIn = (layout: string) => ({ layout }) as unknown as DesignSpec;

describe("settleDirectionLayout", () => {
  it("claims the layout it chose when nobody took it meanwhile", async () => {
    const claim = vi.fn(async () => true);
    const choice = await settleDirectionLayout({
      self: { id: "a", set: SET, slot: 0 },
      readSet: async () => [row("a", 0, "hero-center")],
      choose: async () => ({ spec: specIn("split-left") }),
      claim,
    });
    expect(choice.spec.layout).toBe("split-left");
    expect(claim).toHaveBeenCalledTimes(1);
  });

  /* Decision 5: no transaction is open while documents are built; a claim
     another job won sends this one back to choose from the set as it is. */
  it("chooses again, avoiding what the other job claimed, when it loses", async () => {
    let set = [row("a", 0, "hero-center"), row("b", 1, "hero-center")];
    const chosenFrom: string[][] = [];
    const choice = await settleDirectionLayout({
      self: { id: "a", set: SET, slot: 0 },
      readSet: async () => set,
      choose: async (held) => {
        chosenFrom.push(held);
        return {
          spec: specIn(
            held.includes("split-left") ? "banner-bottom" : "split-left",
          ),
        };
      },
      claim: async (_spec, isFree) => {
        if (chosenFrom.length === 1) {
          set = [row("a", 0, "hero-center"), row("b", 1, "split-left")];
        }
        return isFree(set);
      },
    });
    expect(chosenFrom).toEqual([["hero-center"], ["split-left"]]);
    expect(choice.spec.layout).toBe("banner-bottom");
  });

  it("gives up with the reason after losing three times", async () => {
    await expect(
      settleDirectionLayout({
        self: { id: "a", set: SET, slot: 0 },
        readSet: async () => [],
        choose: async () => ({ spec: specIn("split-left") }),
        claim: async () => false,
      }),
    ).rejects.toBeInstanceOf(LayoutsHeldError);
  });
});
