import { describe, expect, it } from "vitest";
import { type BriefFact, needsFor } from "@/lib/jobs/directions/brief-facts";
import type { OutlinePoint } from "./contract";
import { namesFree } from "./hook";
import { flagOutline } from "./outline-flags";

const fact = (kind: BriefFact["kind"], text: string): BriefFact => ({
  kind,
  text,
  needs: needsFor(kind, text),
});

const FACTS = [
  fact("place", "our Yaba bar"),
  fact("price", "₦2,500 a bottle"),
  fact("date", "Saturday 15 November"),
  fact("time", "8am to 2pm"),
  fact("contact", "WhatsApp 0803 555 0142"),
  fact("quantity", "12 places"),
];

type Draft = Omit<OutlinePoint, "weak">;
let n = 0;
const point = (
  role: OutlinePoint["role"],
  text: string,
  source: OutlinePoint["source"] = "brief",
): Draft => {
  n += 1;
  return { id: `p${n}`, role, title: "Title", point: text, source, facts: [] };
};

const ctx = {
  kind: "carousel" as const,
  facts: FACTS,
  free: namesFree("Kiln Coffee", "cold brew"),
  audience: "Students and young professionals in Yaba",
};

const flags = (points: Draft[]) =>
  flagOutline(points, ctx).map((p) => p.weak?.kind ?? null);

describe("flagOutline", () => {
  it("leaves a set of distinct points from the brief unflagged", () => {
    expect(
      flags([
        point("hook", "Kiln cold brew is steeped for 18 hours"),
        point("body", "Served over ice in a glass bottle"),
        point("body", "Beans grown on the Mambilla Plateau by one cooperative"),
        point("cta", "WhatsApp 0803 555 0142 to reserve a bottle."),
      ]),
    ).toEqual([null, null, null, null]);
  });

  it("flags a point that makes an earlier point's point and names it", () => {
    const points = [
      point("hook", "Our cold brew is steeped slowly for 18 hours"),
      point("body", "Every batch is steeped for 18 hours, slowly"),
      point("cta", "WhatsApp 0803 555 0142 to reserve a bottle."),
    ];
    const [, second] = flagOutline(points, ctx);
    expect(second.weak?.kind).toBe("overlap");
    expect(second.weak?.overlapsWith).toBe(points[0].id);
    expect(second.weak?.reason).toMatch(/^Says the same as point 1\./);
  });

  it.each([
    ["For students and young professionals in Yaba", /who it is for/],
    ["Saturday 15 November, 8am to 2pm", /when it happens/],
    ["At our Yaba bar", /where to find it/],
    ["12 places", /Only gives "12 places"/],
  ])(
    "flags the filler point %s with a reason the owner can act on",
    (text, reason) => {
      const [, middle] = flagOutline(
        [
          point("hook", "Kiln cold brew is steeped for 18 hours"),
          point("body", text),
          point("cta", "WhatsApp 0803 555 0142 to reserve a bottle."),
        ],
        ctx,
      );
      expect(middle.weak?.kind).toBe("filler");
      expect(middle.weak?.reason).toMatch(reason);
    },
  );

  it("flags a profile point, but never a point the owner wrote", () => {
    expect(
      flags([
        point("hook", "Kiln cold brew is steeped for 18 hours"),
        point("body", "Beans from the Mambilla Plateau", "profile"),
        point("body", "Each bottle keeps for five days in the fridge", "user"),
        point("cta", "WhatsApp 0803 555 0142 to reserve a bottle."),
      ]),
    ).toEqual([null, "profile-fill", null, null]);
  });

  it("flags a hook that only names the offer, not one with a reason or a figure", () => {
    const hookFlag = (text: string) =>
      flagOutline(
        [
          point("hook", text),
          point("body", "Served over ice in a glass bottle"),
          point("cta", "WhatsApp 0803 555 0142 to reserve a bottle."),
        ],
        ctx,
      )[0].weak;
    expect(
      hookFlag("Kiln Coffee launches cold brew at our Yaba bar")?.reason,
    ).toMatch(/no reason to swipe/);
    expect(hookFlag("Kiln cold brew is steeped for 18 hours")).toBeNull();
    expect(
      hookFlag(
        "Cold brew steeped slowly over a whole night, then poured over ice",
      ),
    ).toBeNull();
  });

  it("never flags the action, and never flags a hook for giving the day", () => {
    expect(
      flags([
        point("hook", "Saturday 15 November"),
        point("body", "Served over ice in a glass bottle"),
        point("cta", "Saturday 15 November at our Yaba bar"),
      ]),
    ).toEqual([null, null, null]);
  });

  it("takes the first match: an overlapping profile point is overlap", () => {
    expect(
      flags([
        point("hook", "Beans from the Mambilla Plateau, roasted weekly"),
        point("body", "Mambilla Plateau beans, roasted weekly", "profile"),
        point("cta", "WhatsApp 0803 555 0142 to reserve a bottle."),
      ]),
    ).toEqual([null, "overlap", null]);
  });

  it("is deterministic: the same points give the same flags", () => {
    const points = [
      point("hook", "Kiln cold brew is steeped for 18 hours"),
      point("body", "For students in Yaba"),
      point("body", "Beans from the Mambilla Plateau", "profile"),
      point("cta", "WhatsApp 0803 555 0142 to reserve a bottle."),
    ];
    expect(flagOutline(points, ctx)).toEqual(flagOutline(points, ctx));
  });
});
