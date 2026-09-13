import { describe, expect, it } from "vitest";
import {
  allowedCornersFor,
  briefAskedForNoLogo,
  defaultLogoCornerFor,
  LOGO_BOX,
  logoBoxIn,
  logoInsetPx,
  logoIsTheDeliverable,
  logoMarkBox,
  markIsTooThin,
  resolveLogoPlacement,
} from "@/lib/design/logo-placement";
import { DESIGN_LAYOUTS, LOGO_PLACEMENTS } from "@/lib/design/spec";

const CORNERS = LOGO_PLACEMENTS.filter((p) => p !== "none");

describe("defaultLogoCornerFor", () => {
  it.each(DESIGN_LAYOUTS)("gives %s a real corner", (layout) => {
    expect(CORNERS).toContain(defaultLogoCornerFor(layout));
  });

  it("keeps the logo out of split-left's copy column", () => {
    expect(defaultLogoCornerFor("split-left")).toMatch(/-right$/);
  });

  it("keeps the logo out of banner-bottom's copy band", () => {
    expect(defaultLogoCornerFor("banner-bottom")).toMatch(/^top-/);
  });
});

describe("logoIsTheDeliverable", () => {
  it("treats a logo or identity brief as its own replacement", () => {
    expect(logoIsTheDeliverable("Logo")).toBe(true);
    expect(logoIsTheDeliverable("Brand Identity")).toBe(true);
    expect(logoIsTheDeliverable(" logo ")).toBe(true);
  });

  it("does not mistake a neighbouring design type for one", () => {
    expect(logoIsTheDeliverable("Video Thumbnail")).toBe(false);
    expect(logoIsTheDeliverable("Logo Reveal Animation")).toBe(false);
    expect(logoIsTheDeliverable("Flyer")).toBe(false);
    expect(logoIsTheDeliverable(null)).toBe(false);
  });
});

/* The removal question used to be matched here with a regex, and it read
   every insistence that the mark be KEPT as an instruction to drop it. These
   are the briefs that broke it; they now reach the model as prose and come
   back as spec.logoFree, so nothing in this module can get them backwards. */
describe("briefs a regex got backwards", () => {
  const keepTheLogo = [
    "Never omit the logo, it must always appear.",
    "Do not remove the logo from the corner this time",
    "Do not show the logo smaller than last time",
    "Skip the drop shadow on the logo",
    "Our unbranded packaging line launches Friday",
    "No branding changes this quarter — same look as always",
  ];

  it.each(keepTheLogo)("keeps the mark for %j", (briefText) => {
    /* The model answers the brief; this module only obeys. The assertion is
       that no code path here can suppress the logo on this text alone. */
    expect(
      resolveLogoPlacement({
        modelChoice: "top-right",
        hasLogo: true,
        layout: "hero-center",
        logoFree: false,
      }),
    ).toBe("top-right");
    expect(logoIsTheDeliverable(briefText)).toBe(false);
  });
});

describe("resolveLogoPlacement", () => {
  const base = { layout: "hero-center" as const, logoFree: false };

  it("suppresses the logo when the brand has none", () => {
    expect(
      resolveLogoPlacement({
        ...base,
        modelChoice: "top-left",
        hasLogo: false,
      }),
    ).toBe("none");
  });

  it("suppresses the logo when the brief asked for none", () => {
    expect(
      resolveLogoPlacement({
        ...base,
        modelChoice: "top-left",
        hasLogo: true,
        logoFree: true,
      }),
    ).toBe("none");
  });

  /* The regression: the art director picked "none" unprompted and the brand's
     logo vanished from every design with nothing to say so. */
  it.each(DESIGN_LAYOUTS)("overrides an unprompted none on %s", (layout) => {
    const placement = resolveLogoPlacement({
      modelChoice: "none",
      hasLogo: true,
      layout,
      logoFree: false,
    });
    expect(placement).toBe(defaultLogoCornerFor(layout));
    expect(placement).not.toBe("none");
  });

  it.each(CORNERS)(
    "honours the model's %s where the layout allows",
    (corner) => {
      expect(
        resolveLogoPlacement({ ...base, modelChoice: corner, hasLogo: true }),
      ).toBe(corner);
    },
  );

  /* Overriding only "none" was half a guard: the model could still name a
     corner its own layout fills. banner-bottom draws left-aligned copy across
     the lower band, so bottom-left put the mark on the headline. */
  it.each([
    ["banner-bottom", "bottom-left"],
    ["banner-bottom", "bottom-right"],
    ["split-left", "top-left"],
    ["split-left", "bottom-left"],
  ] as const)("refuses %s + %s and falls back", (layout, corner) => {
    const placement = resolveLogoPlacement({
      modelChoice: corner,
      hasLogo: true,
      layout,
      logoFree: false,
    });
    expect(placement).not.toBe(corner);
    expect(placement).toBe(defaultLogoCornerFor(layout));
  });

  it.each(DESIGN_LAYOUTS)("only ever returns a corner %s allows", (layout) => {
    for (const corner of [...CORNERS, "none"] as const) {
      const placement = resolveLogoPlacement({
        modelChoice: corner,
        hasLogo: true,
        layout,
        logoFree: false,
      });
      expect(allowedCornersFor(layout)).toContain(placement);
    }
  });

  it.each(DESIGN_LAYOUTS)(
    "keeps %s's default inside its own allowed set",
    (layout) => {
      expect(allowedCornersFor(layout)).toContain(defaultLogoCornerFor(layout));
    },
  );
});

describe("briefAskedForNoLogo", () => {
  const brief =
    "Announce the autumn collection. No logo on this one — we want the textile to carry it alone. Warm photography throughout.";

  it("accepts a quotation that is really in the brief", () => {
    expect(briefAskedForNoLogo(brief, "No logo on this one")).toBe(true);
  });

  it("tolerates a model re-wrapping the quote", () => {
    expect(briefAskedForNoLogo(brief, "  no logo   on this\n one ")).toBe(true);
  });

  /* The whole point. A boolean can be wrong; a quotation cannot be invented.
     Each of these is a phrase a model might produce for a brief that never
     said it. */
  const notInTheBrief = [
    "leave the logo off",
    "the client asked for no branding",
    "logo-free",
    "without the brand mark",
  ];
  it.each(notInTheBrief)("refuses %j, which is not in the brief", (quote) => {
    expect(briefAskedForNoLogo(brief, quote)).toBe(false);
  });

  /* The guard this replaced asked only whether the brief MENTIONED a logo,
     which passed every brief that discusses one — exactly where a wrong
     answer is likeliest. */
  const discussesTheLogo = [
    "Strong branding, bold colours",
    "Put the logo top-left and make it bigger",
    "Never omit the logo",
    "Keep our watermark on every asset",
  ];
  it.each(discussesTheLogo)("refuses an unquoted claim against %j", (text) => {
    expect(briefAskedForNoLogo(text, "no logo")).toBe(false);
  });

  /* What this does NOT do, deliberately.
     Three stricter guards were tried and all three were wrong: a regex read
     "never omit the logo" as "omit the logo"; containment did the same because
     that IS a substring; and requiring the quote to begin a clause fixed those
     while overriding ten of thirteen genuine requests, since "Please design
     this with no logo" quotes from mid-sentence. Whether a sentence asks for
     removal is a question about negation scope in English and is not settled
     here — the model answers it, and the user is TOLD when the mark was left
     off, which is what makes a wrong answer correctable.

     These cases are recorded as known-permitted, not as desired behaviour, so
     the next person does not re-add a guard that breaks the common case. */
  const permittedButUnproven = [
    [
      "Never omit the logo from any asset.",
      "never omit the logo from any asset",
    ],
    [
      "Do not remove the logo from the corner.",
      "Do not remove the logo from the corner",
    ],
  ] as const;
  it.each(permittedButUnproven)(
    "corroborates but cannot disprove %j",
    (text, quote) => {
      expect(briefAskedForNoLogo(text, quote)).toBe(true);
    },
  );

  /* The common phrasings, which a positional guard rejected. */
  const genuineRequests: [string, string][] = [
    ["Please design this with no logo.", "design this with no logo"],
    [
      "Create a logo-free version for the takeover.",
      "Create a logo-free version",
    ],
    ["Hero banner without the logo, please.", "banner without the logo"],
    ["We want no logo at all on this one.", "We want no logo at all"],
    [
      "Autumn launch.\n- No logo, please\n- Warm photography",
      "No logo, please\n- Warm",
    ],
    ["Keep it logo-free throughout.", "Keep it logo-free throughout"],
  ];
  it.each(genuineRequests)(
    "accepts the ordinary phrasing in %j",
    (text, quote) => {
      expect(briefAskedForNoLogo(text, quote)).toBe(true);
    },
  );

  it("refuses an empty or trivial quote", () => {
    expect(briefAskedForNoLogo(brief, "")).toBe(false);
    expect(briefAskedForNoLogo(brief, "  ")).toBe(false);
    expect(briefAskedForNoLogo(brief, "no")).toBe(false);
    /* Evidence too thin to BE evidence. At a six-character floor "the logo",
       "logo is" and even "prominent" all passed, so a hallucinated claim could
       point at any brief mentioning a logo — and the user was then shown
       "prominent" as their alleged instruction. */
    const vacuous = [
      "the logo",
      "logo is",
      "prominent",
      "logo is prominent",
      "make sure the logo",
    ];
    for (const quote of vacuous) {
      expect(
        briefAskedForNoLogo(
          "Please make sure the logo is prominent and never omit the logo.",
          quote,
        ),
      ).toBe(false);
    }
  });

  it("refuses any quote when there is no brief to check it against", () => {
    expect(briefAskedForNoLogo(null, "No logo on this one")).toBe(false);
    expect(briefAskedForNoLogo("   ", "No logo on this one")).toBe(false);
  });
});

describe("logoBoxIn", () => {
  const canvas = { width: 1000, height: 1000 };

  it("returns nothing when there is no logo to place", () => {
    expect(
      logoBoxIn({ placement: "none", layout: "hero-center", ...canvas }),
    ).toBeNull();
  });

  it.each([
    ["top-left", 80, 80],
    ["top-right", 1000 - 80 - 220, 80],
    ["bottom-left", 80, 1000 - 80 - 120],
    ["bottom-right", 1000 - 80 - 220, 1000 - 80 - 120],
  ] as const)("puts %s at the right corner", (placement, left, top) => {
    expect(
      logoBoxIn({ placement, layout: "hero-center", ...canvas }),
    ).toMatchObject({ left, top, width: 220, height: 120 });
  });

  /* The card layouts draw an inner panel from 8% in, so the mark has to clear
     it or it lands on the centred copy. */
  it.each(["quote-card", "stat-highlight"] as const)(
    "insets further on %s",
    (layout) => {
      expect(logoInsetPx(layout, 1000, 1000)).toBeGreaterThan(
        logoInsetPx("hero-center", 1000, 1000),
      );
    },
  );

  /* The renderer and the contrast check both read this. If they disagree, the
     check measures the wrong part of the picture and reports confidently. */
  it("scales with the canvas", () => {
    const small = logoBoxIn({
      placement: "top-right",
      layout: "hero-center",
      width: 500,
      height: 500,
    });
    expect(small).toMatchObject({ width: 110, height: 60 });
  });
});

describe("logoMarkBox", () => {
  /* Mutating this to return the raw slot used to leave the whole suite green:
     the render tests measure ink ratio, which object-fit: contain preserves
     either way. What the slot-vs-mark distinction actually changes is the
     BACKING plate and the region the contrast check reads. */
  it("fits a square mark inside the slot without using its width", () => {
    expect(logoMarkBox(1)).toEqual({
      width: LOGO_BOX.height,
      height: LOGO_BOX.height,
    });
  });

  it("lets a wide mark use the full slot width", () => {
    const box = logoMarkBox(LOGO_BOX.width / LOGO_BOX.height);
    expect(box.width).toBeCloseTo(LOGO_BOX.width, 5);
    expect(box.height).toBeCloseTo(LOGO_BOX.height, 5);
  });

  it("preserves the ratio at every aspect", () => {
    for (const aspect of [0.1, 0.5, 1, 2, 5, 40]) {
      const box = logoMarkBox(aspect);
      expect(box.width / box.height).toBeCloseTo(aspect, 5);
      expect(box.height).toBeLessThanOrEqual(LOGO_BOX.height + 1e-9);
    }
  });

  /* At a fixed 0.22 width a 20:1 wordmark draws eight pixels tall on a 16:9
     canvas — correct aspect, right corner, and nothing anyone can see. The
     box widens rather than staying thin; the ratio is untouched either way. */
  it("widens for an elongated mark instead of leaving it a hairline", () => {
    const wide = logoMarkBox(8);
    expect(wide.width).toBeGreaterThan(LOGO_BOX.width);
    expect(wide.height).toBeGreaterThanOrEqual(0.03 - 1e-9);
    expect(wide.width / wide.height).toBeCloseTo(8, 5);
  });

  /* Past a point no corner can hold it, and that is reported rather than
     shipped. */
  it("flags a mark too elongated for any corner", () => {
    expect(markIsTooThin(1)).toBe(false);
    expect(markIsTooThin(8)).toBe(false);
    expect(markIsTooThin(20)).toBe(true);
    expect(markIsTooThin(0.05)).toBe(true);
  });

  it("treats an unreadable aspect as square rather than dividing by it", () => {
    for (const bad of [Number.NaN, 0, -3, Number.POSITIVE_INFINITY]) {
      expect(logoMarkBox(bad)).toEqual(logoMarkBox(1));
    }
  });
});

describe("logoBoxIn measures the mark, not the slot", () => {
  const canvas = { width: 1000, height: 1000 };

  /* The blocker this fixes: the contrast check read the slot while the
     renderer drew the fitted mark, so up to 45% of the measured pixels were
     ground the mark never covers — 0.349 measured against 0.0012 true. */
  it("returns a smaller box for a square mark than for the slot", () => {
    const slot = logoBoxIn({
      placement: "bottom-right",
      layout: "hero-center",
      ...canvas,
    });
    const mark = logoBoxIn({
      placement: "bottom-right",
      layout: "hero-center",
      ...canvas,
      aspect: 1,
    });
    expect(mark?.width).toBeLessThan(slot?.width ?? 0);
    expect(mark?.width).toBe(mark?.height);
  });

  it.each(["top-left", "top-right", "bottom-left", "bottom-right"] as const)(
    "keeps the mark box anchored to %s as it is drawn",
    (placement) => {
      const box = logoBoxIn({
        placement,
        layout: "hero-center",
        ...canvas,
        aspect: 1,
      });
      const inset = logoInsetPx("hero-center", canvas.width, canvas.height);
      if (!box) throw new Error("no box");
      if (placement.endsWith("left")) expect(box.left).toBeCloseTo(inset, 5);
      else expect(canvas.width - (box.left + box.width)).toBeCloseTo(inset, 5);
      if (placement.startsWith("top")) expect(box.top).toBeCloseTo(inset, 5);
      else expect(canvas.height - (box.top + box.height)).toBeCloseTo(inset, 5);
    },
  );

  /* Keying the slot to width gave a landscape canvas a mark 21% of its height,
     which reached into the centred headline on every layout. */
  it("sizes off the shorter side, so landscape does not get a huge mark", () => {
    const landscape = logoBoxIn({
      placement: "top-right",
      layout: "hero-center",
      width: 1344,
      height: 756,
      aspect: 1,
    });
    const square = logoBoxIn({
      placement: "top-right",
      layout: "hero-center",
      width: 1000,
      height: 1000,
      aspect: 1,
    });
    expect(landscape?.height).toBeLessThan(square?.height ?? 0);
    expect(landscape?.height).toBeCloseTo(756 * LOGO_BOX.height, 5);
  });
});
