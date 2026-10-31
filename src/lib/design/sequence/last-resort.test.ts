import { describe, expect, it } from "vitest";
import { factLedger } from "@/lib/jobs/directions/claims";
import { blockingFaults, type FaultRules, MAJOR, setFaults } from "./faults";
import {
  beatOf,
  CAFE_BRIEF,
  CAFE_FACTS,
  cafePlan,
  withFrame,
} from "./fixtures";
import {
  framesToTry,
  lastResort,
  lineCuts,
  plainVersions,
} from "./last-resort";

describe("plainVersions", () => {
  it("splits a one-fact owner point and gives its second half a subject", () => {
    const versions = plainVersions(
      beatOf({ headline: "350ml that keeps 5 days" }),
      "Each bottle is 350ml and keeps for 5 days in the fridge",
      "carousel",
    );
    expect(versions[0].change).toEqual({
      headline: "Each bottle is 350ml",
      subheadline: "It keeps for 5 days in the fridge.",
    });
  });

  it("offers the brief's own sentence under a bare claim", () => {
    const versions = plainVersions(
      beatOf({ headline: "Doors open on 3 March" }),
      "Doors open on 3 March",
      "carousel",
      "Ledgerly launches on 3 March. Doors open on 3 March for the first 500 freelancers.",
    );
    expect(versions.map((v) => v.change.subheadline)).toContain(
      "Doors open on 3 March for the first 500 freelancers.",
    );
  });

  it("offers a hook its point's reason over its name", () => {
    const versions = plainVersions(
      beatOf({ role: "hook", headline: "Our sauce is back" }),
      "Ata Kitchen's scotch bonnet sauce, made in small batches in Ibadan",
      "carousel",
    );
    expect(versions.map((v) => v.change)).toContainEqual({
      headline: "Made in small batches in Ibadan",
      subheadline: "Ata Kitchen's scotch bonnet sauce.",
    });
  });

  it("never offers a brief sentence that makes another frame's point", () => {
    const brief =
      "Farmlink rents solar cold rooms to tomato farmers in Kano by the crate. Over 1,140 farmers have rented crates from us since March 2024.";
    const lines = (others: string[]) =>
      plainVersions(
        beatOf({ headline: "1,140 farmers since March 2024" }),
        "1,140 farmers have rented crates from us since March 2024",
        "presentation",
        brief,
        { others },
      ).map((v) => v.change.subheadline);
    const hookLine =
      "Farmlink rents solar cold rooms to tomato farmers in Kano by the crate.";
    expect(lines([])).toContain(hookLine);
    expect(lines([`Who stores tomatoes in Kano? ${hookLine}`])).not.toContain(
      hookLine,
    );
  });

  it("only cuts a subheadline on the hook or the action, never a middle frame", () => {
    const cut = (role: "hook" | "body") =>
      plainVersions(
        beatOf({ role, subheadline: "FreshFold." }),
        "",
        "carousel",
      ).some((v) => v.change.subheadline === "");
    expect(cut("hook")).toBe(true);
    expect(cut("body")).toBe(false);
  });
});

describe("lineCuts", () => {
  it("takes away one footer item or one subheadline sentence at a time", () => {
    const cuts = lineCuts(
      beatOf({
        subheadline: "Steeped 18 hours. Served over ice.",
        footerLines: ["₦2,500 a bottle · Voted best in Lagos"],
      }),
    );
    expect(cuts).toEqual([
      { footerLines: ["Voted best in Lagos"] },
      { footerLines: ["₦2,500 a bottle"] },
      { subheadline: "Served over ice." },
      { subheadline: "Steeped 18 hours." },
    ]);
  });
});

describe("framesToTry", () => {
  const fault = (frame: number, detail: string) => ({
    frame,
    field: "subheadline" as const,
    detail,
    weight: MAJOR,
  });

  it("tries the later frame before the hook that previews it", () => {
    expect(
      framesToTry(
        fault(
          0,
          'the hook already says what frame 3 ("Bottled by hand") is for; leave that point to it',
        ),
        5,
      ),
    ).toEqual([2, 0]);
  });

  it("tries a faulted middle frame before the frame it names", () => {
    expect(
      framesToTry(
        fault(3, `it makes frame 2's point ("Bottled by hand") again`),
        5,
      ),
    ).toEqual([3, 1]);
    expect(
      framesToTry(fault(3, "it has a headline and nothing under it"), 5),
    ).toEqual([3]);
  });
});

describe("lastResort", () => {
  const profile =
    "Served over ice at our Yaba bar. Steeped with spring water from Ogun.";
  const rules: FaultRules = {
    frameCount: 5,
    facts: CAFE_FACTS,
    offering: "cold brew",
    hasImage: true,
    brandName: "Kiln Coffee",
    names: ["cold brew"],
    ledger: factLedger([CAFE_BRIEF, "Kiln Coffee", profile], 1),
  };
  const previewing = () =>
    withFrame(
      withFrame(cafePlan(), 0, {
        subheadline: "Our cold brew, steeped with spring water from Ogun.",
      }),
      3,
      {
        title: "Served over ice",
        headline: "Served over ice at our Yaba bar",
        subheadline:
          "Steeped with spring water from Ogun. Sit in with a glass, or carry yours out.",
      },
    );

  it("clears a hook preview by rewriting the later frame, leaving the hook as written", () => {
    const plan = previewing();
    const preview = /the hook already says what frame 4/;
    const before = blockingFaults(setFaults(plan, rules));
    expect(before.map((f) => f.detail).join(" ")).toMatch(preview);
    const claims = ["", "", "", "Served over ice at our Yaba bar", ""];
    const result = lastResort(plan, rules, claims);
    expect(result.plan.frames[0]).toEqual(plan.frames[0]);
    expect(result.plan.frames[3].subheadline).toBe(
      "Sit in with a glass, or carry yours out.",
    );
    expect(result.blocking.map((f) => f.detail).join(" ")).not.toMatch(preview);
  });
});
