import { describe, expect, it } from "vitest";
import { sentenceCased, withConsistentCasing } from "./casing";
import { beatOf } from "./fixtures";
import { approvedPoints, ownerWritten, pointKeptOnSet } from "./outline-arc";
import { pointTitle } from "./outline-plan";
import { signPoint } from "./outline-sign";
import {
  outlineValidateContext,
  validateApprovedOutline,
} from "./outline-validate";
import { cutToken, titleProblems, withSettledTitles } from "./title";

/* Rubric Addendum D: the mechanical guards the multi-frame set ships
   behind. D1 (the last stand) is in last-stand.test.ts; D2 (left-out
   frames shown and traced) in set-model, set-viewer and the job's tests. */

const SALON = {
  name: "Crown & Coil",
  overview: "Natural hair salon in Lekki Phase 1",
  offer: "Silk presses",
};
const SALON_BRIEF = "Crown & Coil silk press is ₦18,000.";

const outlineWith = (mid: string) => ({
  kind: "carousel",
  points: [
    {
      id: "p1",
      role: "hook",
      title: "Silk press",
      point: "A silk press for ₦18,000",
      source: "brief",
    },
    { id: "p2", role: "body", title: "Find us", point: mid, source: "user" },
    {
      id: "p3",
      role: "cta",
      title: "Book now",
      point: "Book your silk press",
      source: "brief",
    },
  ],
});

const checkSalon = (mid: string) =>
  validateApprovedOutline(
    outlineWith(mid),
    outlineValidateContext("carousel", {
      briefText: SALON_BRIEF,
      brandSummary: SALON as never,
    }),
  );

describe("D3: the owner's own domain and pages count as stated", () => {
  it("passes the brand's name to the link check from the design context", () => {
    expect(
      outlineValidateContext("carousel", {
        briefText: SALON_BRIEF,
        brandSummary: SALON as never,
      }),
    ).toMatchObject({ kind: "carousel", brandName: "Crown & Coil" });
  });

  it("reads '&' in the brand's name as 'and', or as nothing", () => {
    for (const mid of ["Book at crownandcoil.ng", "Book at crowncoil.ng"]) {
      const result = checkSalon(mid);
      expect(result.ok, mid).toBe(true);
      if (result.ok) expect(result.outline.points[1].source).toBe("user");
    }
  });

  it("accepts the owner's Instagram handle, WhatsApp link and Paystack page", () => {
    for (const mid of [
      "See our styles at instagram.com/crownandcoil",
      "See our styles at https://www.instagram.com/crown.and.coil/",
      "Chat to us at wa.me/2348123004455",
      "Chat to us at https://wa.me/2348123004455?text=Hello",
      "Pay your deposit at paystack.com/pay/crownandcoil",
      "Shop our oils at paystack.shop/crown-and-coil",
    ]) {
      expect(checkSalon(mid).ok, mid).toBe(true);
    }
  });

  it("still refuses shorteners, lookalike hosts and a stranger's domain", () => {
    for (const mid of [
      "Book at bit.ly/crownandcoil",
      "Book at crownandcoil.ng.evil.example",
      "See us at instagram.com.evil.example/crownandcoil",
      "See us at lnstagram.com/crownandcoil",
      "Chat at wa.me.example/2348123004455",
      "Pay at paystack.com.ng/pay/crownandcoil",
      "Pay at paystack-pay.com/pay/crownandcoil",
      "Book at crownandcoils.ng",
      "Visit cheaphair.com for wigs",
      "Visit instagram.com for styles",
    ]) {
      const result = checkSalon(mid);
      expect(result.ok, mid).toBe(false);
      if (!result.ok) expect(result.problems[0].rule, mid).toBe("link");
    }
  });
});

/* Integration critic round 1, MEDIUM 2: the owner's webmail was refused
   while a stranger's Instagram or Paystack page, a hyphenated spelling of
   the name and a redirect through the owner's own domain were accepted. */
describe("D3: whose link it is, not which host it is on", () => {
  const checkWithBrief = (brief: string, mid: string) =>
    validateApprovedOutline(
      outlineWith(mid),
      outlineValidateContext("carousel", {
        briefText: brief,
        brandSummary: SALON as never,
      }),
    );

  it("accepts the owner's own address on a webmail host", () => {
    for (const mid of [
      "Write to crownandcoil@gmail.com",
      "Write to crownandcoil@yahoo.com",
      "Questions? Write to crownandcoil.lekki@gmail.com",
      "Write to thecrownandcoil@outlook.com",
    ]) {
      expect(checkSalon(mid).ok, mid).toBe(true);
    }
  });

  it("refuses a stranger's webmail and names the whole address", () => {
    const result = checkSalon("Email hello@gmail.com");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems[0].rule).toBe("link");
      expect(result.problems[0].detail).toContain("hello@gmail.com");
    }
    expect(checkSalon("Email wigsrus@yahoo.com").ok).toBe(false);
  });

  it("refuses a platform page whose handle names someone else", () => {
    for (const mid of [
      "See us at instagram.com/cheapwigs_competitor",
      "Pay at paystack.com/pay/someone-else",
      "Pay at paystack.shop/someone-else",
      "Follow notcrownandcoil at instagram.com/notcrownandcoil",
    ]) {
      const result = checkSalon(mid);
      expect(result.ok, mid).toBe(false);
      if (!result.ok) expect(result.problems[0].rule, mid).toBe("link");
    }
  });

  it("accepts a platform page the brief gives, whatever its handle", () => {
    const brief = `${SALON_BRIEF} Pay at paystack.com/pay/cc-deposit-2026.`;
    expect(
      checkWithBrief(
        brief,
        "Pay your deposit at paystack.com/pay/cc-deposit-2026",
      ).ok,
    ).toBe(true);
  });

  it("does not let the platform's name in the brief vouch for any page on it", () => {
    const brief = `${SALON_BRIEF} Follow instagram.com/crownandcoil.`;
    expect(
      checkWithBrief(brief, "See us at instagram.com/cheapwigs_competitor").ok,
    ).toBe(false);
  });

  it("refuses a hyphenated spelling of the name as a lookalike", () => {
    expect(checkSalon("Book at crown-and-coil.ng").ok).toBe(false);
  });

  it("refuses another ending once the brief gives the owner's domain", () => {
    const brief = `${SALON_BRIEF} Book at crownandcoil.ng.`;
    expect(checkWithBrief(brief, "Book at crownandcoil.ng/silk").ok).toBe(true);
    expect(checkWithBrief(brief, "Book at shop.crownandcoil.ng").ok).toBe(true);
    for (const mid of ["Book at crownandcoil.com", "Book at crowncoil.ng"]) {
      expect(checkWithBrief(brief, mid).ok, mid).toBe(false);
    }
  });

  it("refuses a link that forwards the reader somewhere else", () => {
    for (const mid of [
      "Book at crownandcoil.ng/redirect?to=evil.example",
      "Book at crownandcoil.ng/go?url=https://evil.example",
      "Book at crownandcoil.ng/out/https://evil.example",
    ]) {
      expect(checkSalon(mid).ok, mid).toBe(false);
    }
    expect(checkSalon("Book at https://crownandcoil.ng/book?ref=x").ok).toBe(
      true,
    );
  });
});

describe("D4: money, addresses and names are never cut or re-cased in titles", () => {
  const RAISE = "We are raising $750,000 to build 20 more grids";

  it("never cuts a title at the comma inside a figure", () => {
    const frames = withSettledTitles(
      [
        beatOf({
          role: "hook",
          title: "Cold rooms for Kano",
          headline: "Cold rooms for Kano farmers",
        }),
        beatOf({ role: "body", title: "", headline: RAISE }),
        beatOf({
          role: "cta",
          title: "",
          headline: "Back $750,000 of cold rooms",
          cta: "Email us",
        }),
      ],
      { sources: [`${RAISE}.`] },
    );
    const titles = frames.map((f) => f.title);
    expect(titles.join(" | ")).not.toMatch(/\$750(?![,\d])/);
    expect(titles[1]).toContain("$750,000");
  });

  it("names a title that cuts a figure or an address as a title problem", () => {
    expect(cutToken("We are raising $750", [RAISE])).toBe("$750");
    expect(cutToken("Back $750", ["Back $750,000 of cold rooms."])).toBe(
      "$750",
    );
    expect(
      cutToken("Contact founders@farmlink", ["Write to founders@farmlink.ng"]),
    ).toBe("founders@farmlink");
    expect(cutToken("We are raising $750,000", [RAISE])).toBeNull();
    expect(cutToken("Raising ₦3 million", ["Raising ₦3 million"])).toBeNull();
    const problems = titleProblems(
      [
        {
          title: "We are raising $750",
          headline: RAISE,
          subheadline: "",
          cta: "",
        },
      ],
      { sources: [] },
    );
    expect(problems[0]?.detail).toMatch(/cuts "\$750"/);
  });

  it("keeps an email address and a domain whole and as written in outline titles", () => {
    expect(
      pointTitle("Contact founders@farmlink.ng to join the round"),
    ).toContain("founders@farmlink.ng");
    expect(pointTitle("We are raising $750,000 to build 20 grids")).toContain(
      "$750,000",
    );
    const sources = [
      "Farmlink rents cold rooms. Write to founders@farmlink.ng",
      "Farmlink",
    ];
    expect(sentenceCased("Contact founders@farmlink.ng", sources)).toBe(
      "Contact founders@farmlink.ng",
    );
    expect(sentenceCased("Book at Crownandcoil.ng/Kids", sources)).toBe(
      "Book at Crownandcoil.ng/Kids",
    );
  });

  it("keeps the brand's casing when a set's titles are re-cased", () => {
    const { frames } = withConsistentCasing(
      [
        beatOf({
          role: "hook",
          title: "Free scalp massage offer",
          headline: "Tense scalp in, relaxed scalp out",
        }),
        beatOf({
          role: "body",
          title: "Low-heat training",
          headline: "Every stylist trained in low-heat methods",
        }),
        beatOf({
          role: "cta",
          title: "Book at Crown & Coil",
          headline: "Grab a weekday slot online",
          cta: "crownandcoil.ng",
        }),
        beatOf({
          role: "body",
          title: "Write to hello@CrownAndCoil.ng",
          headline: "Questions go to our front desk",
        }),
      ],
      [SALON_BRIEF, "Crown & Coil"],
    );
    expect(frames[2].title).toBe("Book at Crown & Coil");
    expect(frames[3].title).toBe("Write to hello@CrownAndCoil.ng");
  });
});

describe("D1: which approved points are the owner's", () => {
  const BRIEF = "Kiln Coffee cold brew is ₦2,500 a bottle at our Yaba bar.";
  const ctx = {
    kind: "carousel" as const,
    briefText: BRIEF,
    profileStatements: [],
  };
  const signed = (role: "hook" | "body" | "cta", point: string) => ({
    point,
    source: "brief" as const,
    sig: signPoint({
      kind: "carousel",
      briefText: BRIEF,
      role,
      source: "brief",
      point,
    }),
  });
  const raw = {
    kind: "carousel",
    points: [
      {
        id: "p1",
        role: "hook",
        title: "Cold brew",
        ...signed("hook", "Kiln Coffee cold brew, poured at Yaba"),
      },
      {
        id: "p2",
        role: "body",
        title: "Price",
        /* The planner's words, changed by the owner to the brief's own
           sentence: it reads as "brief", and it is still theirs. */
        ...signed("body", "Every bottle is steeped for a day"),
        point: "Kiln Coffee cold brew is ₦2,500 a bottle at our Yaba bar.",
      },
      {
        id: "u-1",
        role: "body",
        title: "Mine",
        point: "We grind every batch the morning we brew it",
        source: "brief",
      },
      {
        id: "p4",
        role: "cta",
        title: "Visit",
        ...signed("cta", "Pour one at our Yaba bar"),
      },
    ],
  };

  it("marks every point without the planner's signature as edited, whatever its source reads as", () => {
    const result = validateApprovedOutline(raw, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outline.points.map((p) => p.source)).toEqual([
      "brief",
      "brief",
      "user",
      "brief",
    ]);
    expect(result.outline.points.map((p) => p.edited === true)).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(ownerWritten(result.outline)).toEqual([false, true, true, false]);
    expect(approvedPoints(result.outline)[1]).toBe(
      "Kiln Coffee cold brew is ₦2,500 a bottle at our Yaba bar.",
    );
  });

  it("reads the same outline the same way when the job validates the route's output again", () => {
    const once = validateApprovedOutline(raw, ctx);
    if (!once.ok) throw new Error("the outline should pass");
    const twice = validateApprovedOutline(once.outline, ctx);
    if (!twice.ok) throw new Error("the outline should pass again");
    expect(twice.outline).toEqual(once.outline);
    expect(ownerWritten(twice.outline)).toEqual([false, true, true, false]);
  });

  it("never lets a client claim a point is not edited", () => {
    const result = validateApprovedOutline(
      {
        ...raw,
        points: raw.points.map((p) => ({ ...p, edited: false })),
      },
      ctx,
    );
    expect(result.ok && result.outline.points[2].edited).toBe(true);
  });

  it("reads a point as kept on the set from its figures and most of its words", () => {
    const frames = [
      beatOf({ headline: "Steeped a full day" }),
      beatOf({
        headline: "Pour one at Yaba",
        footerLines: ["₦2,500 a bottle"],
      }),
    ];
    expect(pointKeptOnSet(frames, "₦2,500 a bottle")).toBe(true);
    expect(pointKeptOnSet(frames, "₦3,000 a bottle")).toBe(false);
    expect(
      pointKeptOnSet(frames, "1,140 farmers have rented crates since March"),
    ).toBe(false);
  });
});
