import { describe, expect, it } from "vitest";
import type { DesignSpec } from "@/lib/design/spec";
import {
  type ArcPoint,
  claimsOverlap,
  pointPool,
  roleOf,
  settleArc,
  sparePoints,
  textsOverlap,
} from "./arc";
import { fact } from "./fixtures";

/* A brief that is no eval fixture: a bicycle workshop. */
const BRIEF =
  "Bike servicing at our Ojota workshop. Gears tuned and brakes bled in one visit. Free pickup for 3 bikes or more. ₦12,000 a service. Saturday 6 December, 9am to 4pm. Message 0809 111 2222 to book.";

const FACTS = [
  fact("product", "bike servicing"),
  fact("place", "our Ojota workshop"),
  fact("condition", "Free pickup for 3 bikes or more"),
  fact("price", "₦12,000 a service"),
  fact("date", "Saturday 6 December"),
  fact("time", "9am to 4pm"),
  fact("contact", "Message 0809 111 2222"),
];

const BRAND = {
  differentiators:
    "Mechanics who race on weekends; parts stocked for every major brand",
  offer: "Servicing, repairs and wheel builds",
  values: "Fix it right the first time",
};

const FREE = new Set(["bike", "servic", "spoke", "chain"]);

const pool = (kind: "carousel" | "presentation" = "carousel") =>
  pointPool({ facts: FACTS, briefText: BRIEF, brand: BRAND, kind, free: FREE });

const frame = (
  point: number,
  title = `Title ${point}`,
): {
  point: number;
  title: string;
  layout: DesignSpec["layout"];
  showsImage: boolean;
} => ({ point, title, layout: "hero-center", showsImage: false });

describe("roleOf", () => {
  it("is the hook first, the action last and a point between", () => {
    expect([0, 1, 2, 3].map((i) => roleOf(i, 4))).toEqual([
      "hook",
      "body",
      "body",
      "cta",
    ]);
  });
});

describe("textsOverlap and claimsOverlap", () => {
  it("reads one point said in other words as overlapping", () => {
    expect(
      textsOverlap(
        "Mechanics who race on weekends",
        "Our mechanics race every weekend",
      ),
    ).toBe(true);
  });

  it("keeps two different points apart", () => {
    expect(
      textsOverlap(
        "Mechanics who race on weekends",
        "Parts stocked for every major brand",
      ),
    ).toBe(false);
  });

  it("reads two points sharing a fact that is a point on its own as one", () => {
    const a = { text: "Pickup is free", facts: [2] };
    const b = { text: "We come to you", facts: [2] };
    expect(claimsOverlap(a, b, FACTS)).toBe(true);
  });

  it("lets two points both happen at the venue", () => {
    const a = { text: "Gears tuned at our Ojota workshop", facts: [1] };
    const b = { text: "Wheel builds at our Ojota workshop", facts: [1] };
    expect(claimsOverlap(a, b, FACTS)).toBe(false);
  });
});

describe("pointPool", () => {
  it("lists the brief's clauses first, then its point facts, then the profile's", () => {
    const sources = pool().map((p) => p.source);
    expect(sources[0]).toBe("brief");
    expect(sources.lastIndexOf("brief")).toBeLessThan(
      sources.indexOf("profile"),
    );
    expect(pool().map((p) => p.text)).toContain(
      "Gears tuned and brakes bled in one visit",
    );
    expect(pool().map((p) => p.text)).toContain(
      "Mechanics who race on weekends",
    );
  });

  it("never lists a carousel's price as a point, but lists a deck's", () => {
    expect(pool().some((p) => p.text === "₦12,000 a service")).toBe(false);
    expect(
      pool("presentation").some((p) => p.text === "₦12,000 a service"),
    ).toBe(true);
  });

  it("leaves out a candidate that makes a point already listed", () => {
    const listed = pointPool({
      facts: FACTS,
      briefText: BRIEF,
      brand: { ...BRAND, values: "Mechanics who race every weekend" },
      kind: "carousel",
      free: FREE,
    });
    expect(
      listed.filter((p) => /race/.test(p.text)).map((p) => p.text),
    ).toEqual(["Mechanics who race on weekends"]);
  });
});

describe("pointPool: what is not a point", () => {
  it("leaves out the request itself and the action", () => {
    const texts = pointPool({
      facts: FACTS,
      briefText: `Carousel for our service week. ${BRIEF} Reserve a slot early.`,
      brand: BRAND,
      kind: "carousel",
      free: FREE,
    }).map((p) => p.text);
    expect(texts.some((t) => /carousel/i.test(t))).toBe(false);
    expect(texts.some((t) => /reserve|message/i.test(t))).toBe(false);
  });

  it("offers who it is for, then where and when, only when the points run short", () => {
    const thin = (slots: number) =>
      pointPool({
        facts: FACTS,
        briefText: BRIEF,
        brand: { targetAudience: "Weekend riders in Lagos" },
        kind: "carousel",
        free: FREE,
        slots,
      }).map((p) => p.text);
    const base = thin(0);
    expect(base).not.toContain("For Weekend riders in Lagos");
    expect(thin(base.length + 1).at(-1)).toBe("For Weekend riders in Lagos");
    expect(thin(base.length + 2).at(-1)).toBe(
      "our Ojota workshop, Saturday 6 December, 9am to 4pm",
    );
    expect(thin(base.length + 3).slice(-2)).toEqual([
      "our Ojota workshop",
      "Saturday 6 December, 9am to 4pm",
    ]);
  });
});

describe("settleArc", () => {
  const points: ArcPoint[] = [
    {
      source: "brief",
      text: "Gears tuned and brakes bled in one visit",
      facts: [],
    },
    { source: "fact", text: "Free pickup for 3 bikes or more", facts: [2] },
    { source: "profile", text: "Mechanics who race on weekends", facts: [] },
    { source: "profile", text: "Our mechanics race every weekend", facts: [] },
    {
      source: "profile",
      text: "Parts stocked for every major brand",
      facts: [],
    },
  ];
  const options = {
    pool: points,
    facts: FACTS,
    kind: "carousel" as const,
    offeringFact: 0,
    hasImage: true,
    free: FREE,
  };
  const answer = (frames: ReturnType<typeof frame>[], over = {}) => ({
    hookAngle: "Your bike leaves tuned and safe after one visit",
    spare: [],
    sameAs: [],
    frames,
    ...over,
  });

  it("gives each frame its assigned point and its role", () => {
    const arc = settleArc(
      answer([frame(1), frame(2), frame(3), frame(0)]),
      options,
    );
    expect(arc.frames.map((f) => f.role)).toEqual([
      "hook",
      "body",
      "body",
      "cta",
    ]);
    expect(arc.frames.map((f) => f.claim)).toEqual([
      "Your bike leaves tuned and safe after one visit",
      "Free pickup for 3 bikes or more",
      "Mechanics who race on weekends",
      "",
    ]);
    expect(arc.replaced).toEqual([]);
  });

  it("replaces a point that overlaps one already placed with the next ranked unused point", () => {
    const arc = settleArc(
      answer([frame(1), frame(3), frame(4), frame(0)], { spare: [5, 2] }),
      options,
    );
    expect(arc.frames[2].claim).toBe("Parts stocked for every major brand");
    expect(arc.replaced).toEqual([{ frame: 2, from: 3, to: 4 }]);
  });

  it("replaces a point used twice, missing, or out of range", () => {
    const arc = settleArc(
      answer([frame(1), frame(3), frame(3), frame(99), frame(0)]),
      options,
    );
    const claims = arc.frames.slice(1, 4).map((f) => f.claim);
    expect(new Set(claims).size).toBe(3);
    expect(arc.replaced.map((r) => r.frame)).toEqual([2, 3]);
  });

  it("holds the model's own sameAs pairs as one point", () => {
    const arc = settleArc(
      answer([frame(1), frame(3), frame(5), frame(0)], {
        sameAs: [{ a: 3, b: 5 }],
        spare: [2],
      }),
      options,
    );
    expect(arc.frames[2].claim).toBe("Free pickup for 3 bikes or more");
    expect(sparePoints(arc, points, FACTS, FREE)).not.toContain(4);
  });

  it("drops a hook angle that gives a carousel's price for its point's words", () => {
    const arc = settleArc(
      answer([frame(1), frame(3), frame(0)], {
        hookAngle: "A full service for ₦12,000",
      }),
      options,
    );
    expect(arc.frames[0].claim).toBe(
      "Gears tuned and brakes bled in one visit",
    );
    expect(arc.angleDropped).toMatch(/price/);
  });

  it("states every fact once: the offering and the day on the hook, the price, place, time and contact on the action", () => {
    const arc = settleArc(
      answer([frame(1), frame(2), frame(3), frame(0)]),
      options,
    );
    expect(arc.frames[0].facts).toEqual([0, 4]);
    expect(arc.frames[1].facts).toEqual([2]);
    expect(arc.frames[3].facts).toEqual([1, 3, 5, 6]);
    expect(arc.frames.flatMap((f) => f.facts).sort()).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });

  it("leaves a deck's price on the slide whose point it is", () => {
    const deckPool: ArcPoint[] = [
      ...points,
      { source: "fact", text: "₦12,000 a service", facts: [3] },
    ];
    const arc = settleArc(answer([frame(1), frame(6), frame(0)]), {
      ...options,
      pool: deckPool,
      kind: "presentation",
    });
    expect(arc.frames[1].facts).toContain(3);
  });

  it("gives a frame the closest unused point once every distinct one is spent", () => {
    const shared: ArcPoint[] = [
      points[0],
      points[1],
      { source: "brief", text: "We collect your bike for nothing", facts: [2] },
    ];
    const arc = settleArc(answer([frame(1), frame(2), frame(3), frame(0)]), {
      ...options,
      pool: shared,
    });
    expect(arc.crowded).toEqual([2]);
    expect(arc.frames[2].claim).toBe("We collect your bike for nothing");
  });

  it("leaves a frame for the writer rather than give it a point said again", () => {
    const arc = settleArc(answer([frame(1), frame(3), frame(4), frame(0)]), {
      ...options,
      pool: [points[0], points[2], points[3]],
    });
    expect(arc.crowded).toEqual([]);
    expect(arc.unsourced).toEqual([2]);
  });

  it("holds two points of one kind as one point", () => {
    const arc = settleArc(
      answer([frame(1), frame(3), frame(5), frame(0)], {
        kinds: [
          "how-it-works",
          "what-you-get",
          "who-makes-it",
          "who-makes-it",
          "who-makes-it",
        ],
        spare: [2],
      }),
      options,
    );
    expect(arc.frames[2].claim).toBe("Free pickup for 3 bikes or more");
  });

  it("names a frame no unused point was left for", () => {
    const arc = settleArc(answer([frame(1), frame(2), frame(2), frame(0)]), {
      ...options,
      pool: points.slice(0, 2),
    });
    expect(arc.unsourced).toEqual([2]);
    expect(arc.frames[2].claim).toBe("");
  });

  it("keeps a point the hook's angle only shares a word with", () => {
    const arc = settleArc(
      answer([frame(1), frame(3), frame(0)], {
        hookAngle: "Our mechanics get your bike back the same visit",
      }),
      options,
    );
    expect(arc.frames[1].claim).toBe("Mechanics who race on weekends");
  });

  it("keeps the arc's titles as proposals, cleaned, and shows the image on the hook", () => {
    const arc = settleArc(
      answer([
        frame(1, "The service — version A"),
        frame(2, "Who fixes it"),
        frame(3, "Pickup"),
        frame(0, "Book"),
      ]),
      options,
    );
    expect(arc.frames.map((f) => f.title)).toEqual([
      "The service",
      "Who fixes it",
      "Pickup",
      "Book",
    ]);
    expect(arc.frames[0].showsImage).toBe(true);
  });

  it("cycles three compositions in a set with no image", () => {
    const arc = settleArc(
      answer(
        Array.from({ length: 8 }, (_, i) =>
          frame(i === 7 ? 0 : (i % 3) + 1, `Frame name ${i}`),
        ),
      ),
      { ...options, hasImage: false },
    );
    const layouts = arc.frames.map((f) => f.layout);
    expect(new Set(layouts).size).toBeGreaterThanOrEqual(3);
    for (let i = 2; i < layouts.length; i += 1) {
      expect(layouts[i]).not.toBe(layouts[i - 2]);
    }
  });

  it("sets no neighbouring frames in one layout and no text-led frame in an image layout", () => {
    const arc = settleArc(
      answer([
        { ...frame(1), layout: "split-left", showsImage: true },
        { ...frame(2), layout: "split-left", showsImage: false },
        { ...frame(3), layout: "hero-center", showsImage: false },
        { ...frame(0), layout: "hero-center", showsImage: false },
      ]),
      options,
    );
    const layouts = arc.frames.map((f) => f.layout);
    for (let i = 1; i < layouts.length; i += 1) {
      expect(layouts[i]).not.toBe(layouts[i - 1]);
    }
    expect(layouts[1]).not.toBe("split-left");
  });
});
