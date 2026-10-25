import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type DesignDocument,
  type DesignElement,
  DOCUMENT_LIMITS,
  designDocumentSchema,
  MAX_GRADIENT_STOPS,
} from "./schema";
import { schemaBounds, worstCaseDocument } from "./testing-cost";
import {
  MAX_EMOJI_PER_DOCUMENT,
  MAX_EMOJI_PER_TEXT,
  MAX_MARKS_PER_CLUSTER,
} from "./text-safety";

/**
 * What the schema does at every cost bound, not how it is written.
 *
 * Pinning the bounds as declared (cost-bench.json) missed bounds hidden in a
 * union with a looser branch, a transform that grows the value after the
 * check, and a refinement deleted outright: the copy budget could be removed
 * with the whole suite green, and a union let a 7680 px border through at
 * 6.9 s. Here every bound is driven through the real parser: the value at
 * the bound parses and comes back unchanged, one step past it is refused.
 * Each case is a document holding only what it tests, so a refusal can only
 * come from the bound under test.
 */

const worst = worstCaseDocument();
const CANVAS = { width: worst.width, height: worst.height };

function documentOf(elements: DesignElement[]): DesignDocument {
  return { version: 1, ...CANVAS, background: "#FFFFFF", elements };
}

/** The worst case's element of each type, with its copy cut to one letter so
 *  the copy budget never decides a field's case. */
function plain(type: DesignElement["type"], id: string = type): DesignElement {
  const found = worst.elements.find((element) => element.type === type);
  if (!found) throw new Error(`worst case has no ${type}`);
  const element = { ...found, id, name: id } as DesignElement;
  if (element.type === "text") element.text = "a";
  if (element.type === "button") element.label = "a";
  /* Gradients have their own cap; a plain fill keeps it out of other cases. */
  if (element.type === "shape") element.fill = "#336699";
  return element;
}

function withField(
  element: DesignElement,
  path: string[],
  value: unknown,
): DesignElement {
  const copy = structuredClone(element) as Record<string, unknown>;
  let node = copy;
  for (const key of path.slice(0, -1)) {
    node[key] = { ...(node[key] as Record<string, unknown>) };
    node = node[key] as Record<string, unknown>;
  }
  node[path[path.length - 1]] = value;
  return copy as unknown as DesignElement;
}

const parses = (doc: DesignDocument) => designDocumentSchema.safeParse(doc);

/* Every look a run of text can take. A rule can hide behind one: a role cap
   that skipped runs set in the body face, and a transform that grew only
   non-italic type, both passed while every test document was italic in
   the heading face. */
const LOOKS = [
  {},
  { italic: false },
  { font: "body" },
  { align: "center" },
  { align: "right" },
  { fontWeight: 100 },
  { fontWeight: 900 },
] as const;

function inEveryLook(doc: DesignDocument): DesignDocument[] {
  return LOOKS.map((look) => ({
    ...doc,
    elements: doc.elements.map((element) => {
      if (element.type === "text")
        return { ...element, ...look } as DesignElement;
      if (element.type === "button" && "fontWeight" in look) {
        return { ...element, fontWeight: look.fontWeight } as DesignElement;
      }
      return element;
    }),
  }));
}

function expectAccepted(doc: DesignDocument) {
  for (const variant of inEveryLook(doc)) {
    const result = parses(variant);
    expect(result.error?.issues ?? []).toEqual([]);
    /* A transform that grows a value after the bound check passes the
       check and draws the grown value; the parsed document must be the
       input. */
    expect(result.data).toEqual(variant);
  }
}

function expectRefused(doc: DesignDocument) {
  for (const variant of inEveryLook(doc)) {
    expect(parses(variant).success).toBe(false);
  }
}

/* Past a bound by less than any value a person or model would choose, but
   by more than floating-point noise. */
const past = (bound: number, direction: 1 | -1) =>
  bound + direction * Math.max(1e-6, Math.abs(bound) * 1e-9);

const TYPES = ["image", "shape", "text", "button", "logo"] as const;

const numericCases = Object.entries(schemaBounds()).flatMap(([path, bound]) => {
  const [type, ...field] = path.split(".");
  if (!TYPES.includes(type as (typeof TYPES)[number]) || field.length === 0)
    return [];
  const cases: [string, string[], number, number][] = [];
  if (bound.maximum !== undefined)
    cases.push([path, field, bound.maximum, past(bound.maximum, 1)]);
  if (bound.minimum !== undefined)
    cases.push([path, field, bound.minimum, past(bound.minimum, -1)]);
  if (bound.exclusiveMinimum !== undefined)
    cases.push([
      path,
      field,
      past(bound.exclusiveMinimum, 1),
      bound.exclusiveMinimum,
    ]);
  return cases.map(([name, keys, at, over]) => ({
    name,
    type: type as DesignElement["type"],
    keys,
    at,
    over,
  }));
});

describe("every numeric bound, through the parser", () => {
  it("finds the cost bounds it has to test", () => {
    const names = new Set(numericCases.map((c) => c.name));
    for (const name of [
      "shape.borderWidth",
      "shape.radius",
      "text.fontSize",
      "text.lineHeight",
      "text.letterSpacing",
      "image.crop.zoom",
      "image.width",
      "button.fontSize",
    ]) {
      expect(names).toContain(name);
    }
  });

  it.each(numericCases)("$name: $at parses, $over is refused", (c) => {
    const base = plain(c.type);
    expectAccepted(documentOf([withField(base, c.keys, c.at)]));
    expectRefused(documentOf([withField(base, c.keys, c.over)]));
  });
});

describe("every copy-length bound, through the parser", () => {
  const lengths = [
    ["text", ["text"], schemaBounds()["text.text"]?.maxLength],
    ["button", ["label"], schemaBounds()["button.label"]?.maxLength],
  ] as const;

  it.each(lengths)(
    "%s.%s at its longest parses, one more is refused",
    (type, keys, max) => {
      expect(max).toBeGreaterThan(0);
      const base = plain(type);
      expectAccepted(
        documentOf([withField(base, [...keys], "a".repeat(max ?? 0))]),
      );
      expectRefused(
        documentOf([withField(base, [...keys], "a".repeat((max ?? 0) + 1))]),
      );
    },
  );
});

describe("every count the refinements check, through the parser", () => {
  const many = (type: DesignElement["type"], count: number) =>
    Array.from({ length: count }, (_, i) => plain(type, `${type}-${i}`));

  it.each(Object.entries(DOCUMENT_LIMITS.byType))(
    "%s: %i parse, one more is refused",
    (type, max) => {
      const kind = type as DesignElement["type"];
      const roles = Object.entries(DOCUMENT_LIMITS.byRole).flatMap(
        ([role, n]) => Array.from({ length: n }, () => role),
      );
      const elements = (count: number) =>
        many(kind, count).map((element, i) =>
          element.type === "text"
            ? { ...element, role: roles[i % roles.length] as "body" }
            : element,
        );
      expectAccepted(documentOf(elements(max)));
      expectRefused(documentOf(elements(max + 1)));
    },
  );

  it.each(Object.entries(DOCUMENT_LIMITS.byRole))(
    "%s text: %i parse, one more is refused",
    (role, max) => {
      const elements = (count: number) =>
        many("text", count).map((element) => ({
          ...element,
          role: role as "body",
        }));
      expectAccepted(documentOf(elements(max)));
      expectRefused(documentOf(elements(max + 1)));
    },
  );

  it("gradient fills: the cap parses, one more is refused", () => {
    const gradient = worst.elements.find(
      (element) =>
        element.type === "shape" && element.fill.startsWith("linear-gradient"),
    );
    if (gradient?.type !== "shape")
      throw new Error("worst case has no gradient");
    const elements = (count: number) =>
      many("shape", count).map((element) => ({
        ...element,
        fill: gradient.fill,
      }));
    expectAccepted(documentOf(elements(DOCUMENT_LIMITS.gradients)));
    expectRefused(documentOf(elements(DOCUMENT_LIMITS.gradients + 1)));
  });

  it("elements in all: the cap parses, one more is refused", () => {
    const cap = DOCUMENT_LIMITS.elements;
    const fits = [
      ...many("image", DOCUMENT_LIMITS.byType.image),
      ...many("shape", DOCUMENT_LIMITS.byType.shape),
      ...many("text", DOCUMENT_LIMITS.byType.text).map((element, i) => ({
        ...element,
        role: (["headline", "subheadline", "cta", "footer", "body"] as const)[
          i % 5
        ],
      })),
      ...many("button", DOCUMENT_LIMITS.byType.button),
      ...many("logo", DOCUMENT_LIMITS.byType.logo),
    ];
    expect(fits.length).toBeGreaterThan(cap);
    expectAccepted(documentOf(fits.slice(0, cap)));
    expectRefused(documentOf(fits.slice(0, cap + 1)));
  });

  it("copy in all: the budget parses, one more code point is refused", () => {
    const budget = DOCUMENT_LIMITS.textCodePoints;
    const runs = (total: number) => {
      const max = schemaBounds()["text.text"]?.maxLength ?? 0;
      const texts: DesignElement[] = [];
      for (let left = total, i = 0; left > 0; i += 1) {
        const length = Math.min(max, left);
        texts.push({
          ...plain("text", `copy-${i}`),
          role: "body",
          text: "a".repeat(length),
        } as DesignElement);
        left -= length;
      }
      return texts;
    };
    expectAccepted(documentOf(runs(budget)));
    expectRefused(documentOf(runs(budget + 1)));
  });
});

describe("emoji, through the parser", () => {
  /* Distinct single-code-point pictographs, spaced so none joins another. */
  const emoji = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      String.fromCodePoint(0x1f600 + i),
    ).join(" ");

  const textWith = (copy: string, id = "t") =>
    ({ ...plain("text", id), role: "body", text: copy }) as DesignElement;

  it("one run: the cap parses, one more is refused", () => {
    /* One emoji repeated, so the per-design cap on distinct emoji cannot be
       what refuses the extra one. */
    const repeated = (count: number) =>
      Array(count).fill("\u{1F600}").join(" ");
    expectAccepted(documentOf([textWith(repeated(MAX_EMOJI_PER_TEXT))]));
    expectRefused(documentOf([textWith(repeated(MAX_EMOJI_PER_TEXT + 1))]));
  });

  it("one design: the cap parses, one more distinct emoji is refused", () => {
    const split = (total: number) => {
      const all = Array.from(emoji(total).replaceAll(" ", ""));
      const half = Math.ceil(all.length / 2);
      return [
        textWith(all.slice(0, half).join(" "), "a"),
        textWith(all.slice(half).join(" "), "b"),
      ];
    };
    expectAccepted(documentOf(split(MAX_EMOJI_PER_DOCUMENT)));
    expectRefused(documentOf(split(MAX_EMOJI_PER_DOCUMENT + 1)));
  });

  /* Each picture satori fetches is one emoji, however many code points spell
     it. A cap that counted only single pictographs let 144 distinct pictures
     through by stripping skin tones before counting (5.3-5.9 s cold). */
  const TONES = [
    "\u{1F3FB}",
    "\u{1F3FC}",
    "\u{1F3FD}",
    "\u{1F3FE}",
    "\u{1F3FF}",
  ];
  const SEQUENCES: Record<string, string[]> = {
    "skin-tone": ["👍", "👋", "✋", "👌", "👏", "🙏"].flatMap((base) =>
      TONES.map((tone) => base + tone),
    ),
    "zero-width-joiner": ["👨", "👩", "🧑"].flatMap((person) =>
      ["🍳", "🎓", "🎤", "🎨", "🏫", "🏭", "💻", "💼", "🔧", "🔬"].map(
        (tool) => `${person}‍${tool}`,
      ),
    ),
    flag: [
      "NG",
      "GH",
      "KE",
      "ZA",
      "EG",
      "US",
      "GB",
      "FR",
      "DE",
      "IT",
      "ES",
      "PT",
      "BR",
      "AR",
      "MX",
      "CA",
      "JP",
      "KR",
      "CN",
      "IN",
      "AU",
      "NZ",
      "SE",
      "NO",
      "DK",
      "FI",
    ].map((code) =>
      Array.from(code, (letter) =>
        String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65),
      ).join(""),
    ),
    /* Only twelve keycaps exist; the rest of the row fills the cap. */
    "keycap, filled to the cap": [
      ..."0123456789#*".split("").map((key) => `${key}️⃣`),
      ...["👍", "👋"].flatMap((base) => TONES.map((tone) => base + tone)),
      ..."😀😁😂😃".split(/(?:)/u),
    ],
  };

  /* Pictographs that are text by default. Satori fetches each as a picture
     whether or not VS16 asks for emoji presentation, so both spellings count. */
  const TEXT_DEFAULT = Array.from(
    "☀☁☂☃☄☎☑☘☝☠☢☣☦☪☮☯☸☹☺♀♂♟♠♣♥♦♨♻⚒⚔⚕⚖⚗⚙⚛⚜⚠✂✈✉✌✍✏✒✔✖✝✡✳✴❄❇❣❤",
  );
  SEQUENCES["text-default with VS16"] = TEXT_DEFAULT.map(
    (pictograph) => `${pictograph}️`,
  );
  SEQUENCES["text-default bare"] = TEXT_DEFAULT;
  /* Every one starts with the same person and tone, so a count keyed on the
     first element, or with tones stripped inside a sequence, sees one. */
  SEQUENCES["toned person joined to a tool"] = TONES.flatMap((tone) =>
    ["🍳", "🎓", "🎤", "🎨", "🏫", "🔬"].map((tool) => `👩${tone}‍${tool}`),
  );
  /* Every one shares its first two elements. */
  const KIN = ["👧", "👦", "👶", "🧒", "👨", "👩"];
  SEQUENCES["family sharing two elements"] = [
    ...KIN.map((a) => `👨‍👩‍${a}`),
    ...KIN.flatMap((a) => KIN.map((b) => `👨‍👩‍${a}‍${b}`)),
  ];
  SEQUENCES["lone regional indicator"] = Array.from({ length: 26 }, (_, i) =>
    String.fromCodePoint(0x1f1e6 + i),
  );

  it.each(Object.entries(SEQUENCES))(
    "one design: %s sequences count one each, one more distinct is refused",
    (_, sequences) => {
      expect(sequences.length).toBeGreaterThan(MAX_EMOJI_PER_DOCUMENT);
      const split = (total: number) => {
        const all = sequences.slice(0, total);
        const half = Math.ceil(all.length / 2);
        return [
          textWith(all.slice(0, half).join(" "), "a"),
          textWith(all.slice(half).join(" "), "b"),
        ];
      };
      expectAccepted(documentOf(split(MAX_EMOJI_PER_DOCUMENT)));
      expectRefused(documentOf(split(MAX_EMOJI_PER_DOCUMENT + 1)));
    },
  );
});

describe("gradient stops, through the parser", () => {
  const gradient = (stops: number) =>
    `linear-gradient(90deg, ${Array.from(
      { length: stops },
      (_, i) =>
        `${i % 2 ? "#FF0000" : "#0000FF"} ${Math.round((i / (stops - 1)) * 100)}%`,
    ).join(", ")})`;

  it("the cap parses, one more stop is refused", () => {
    const shape = (stops: number) =>
      ({ ...plain("shape"), fill: gradient(stops) }) as DesignElement;
    expectAccepted(documentOf([shape(MAX_GRADIENT_STOPS)]));
    expectRefused(documentOf([shape(MAX_GRADIENT_STOPS + 1)]));
  });
});

describe("no number without a bound", () => {
  /* A new numeric field with no limit is a cost nobody benched: the
     renderer may draw it at any size. Every number the schema accepts on an
     element has a ceiling and a floor. */
  it("every element number has a minimum and a maximum", () => {
    const json = z.toJSONSchema(designDocumentSchema, {
      unrepresentable: "any",
      io: "input",
    });
    const unbounded: string[] = [];
    const visit = (node: unknown, path: string) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const child of node) visit(child, path);
        return;
      }
      const record = node as Record<string, unknown>;
      if (
        (record.type === "number" || record.type === "integer") &&
        record.const === undefined &&
        record.enum === undefined &&
        path.includes("elements") &&
        ((record.maximum === undefined &&
          record.exclusiveMaximum === undefined) ||
          (record.minimum === undefined &&
            record.exclusiveMinimum === undefined))
      ) {
        unbounded.push(path);
      }
      for (const [key, child] of Object.entries(record)) {
        visit(child, `${path}/${key}`);
      }
    };
    visit(json, "");
    expect(unbounded).toEqual([]);
  });
});

/**
 * Each cap again, with the overflow in every element that can carry it.
 *
 * One document shape per cap let a cap be loosened where that shape never
 * looks: the copy budget summed over the first two elements, headlines or
 * button labels left out of it, gradients counted on shapes only, the
 * emoji cap on the first two runs, labels skipping the text checks. All
 * passed with copy only in body runs and gradients only on shapes. Here the
 * load is spread over every carrier the caps allow (every text role and
 * both buttons) and the one-too-many lands on each carrier in turn.
 */
describe("every cap, overflowing in every carrier", () => {
  const ROLES = Object.entries(DOCUMENT_LIMITS.byRole)
    .flatMap(([role, n]) => Array.from({ length: n }, () => role))
    .slice(0, DOCUMENT_LIMITS.byType.text);

  /** One element per place copy can go: every text run the caps allow, by
   *  role, and every button. */
  function carriers(copies: string[]): DesignElement[] {
    const texts = ROLES.map(
      (role, i) =>
        ({
          ...plain("text", `text-${i}`),
          role,
          text: copies[i],
        }) as DesignElement,
    );
    const buttons = Array.from(
      { length: DOCUMENT_LIMITS.byType.button },
      (_, i) =>
        ({
          ...plain("button", `button-${i}`),
          label: copies[ROLES.length + i],
        }) as DesignElement,
    );
    return [...texts, ...buttons];
  }
  const CARRIERS = ROLES.length + DOCUMENT_LIMITS.byType.button;
  const names = [
    ...ROLES.map((role, i) => `${role} run ${i}`),
    ...Array.from(
      { length: DOCUMENT_LIMITS.byType.button },
      (_, i) => `button ${i}`,
    ),
  ];

  /** `total` copy spread evenly, with the remainder on carrier `last`. */
  function spread(total: number, last: number): string[] {
    const share = Math.floor(total / CARRIERS);
    return Array.from({ length: CARRIERS }, (_, i) =>
      "a".repeat(share + (i === last ? total - share * CARRIERS : 0)),
    );
  }

  it("spreads the full copy budget over every carrier", () => {
    expectAccepted(
      documentOf(carriers(spread(DOCUMENT_LIMITS.textCodePoints, 0))),
    );
  });

  it.each(names.map((name, i) => [name, i] as const))(
    "copy budget plus one, the extra in %s, is refused",
    (_, i) => {
      expectRefused(
        documentOf(carriers(spread(DOCUMENT_LIMITS.textCodePoints + 1, i))),
      );
    },
  );

  /* Distinct pictographs, as many on each carrier as the total allows. */
  function emojiSpread(total: number, last: number): string[] {
    const all = Array.from({ length: total }, (_, i) =>
      String.fromCodePoint(0x1f600 + i),
    );
    const share = Math.floor(total / CARRIERS);
    const runs: string[] = [];
    let next = 0;
    for (let i = 0; i < CARRIERS; i += 1) {
      const count = share + (i === last ? total - share * CARRIERS : 0);
      runs.push(all.slice(next, next + count).join(" ") || "a");
      next += count;
    }
    return runs;
  }

  it("spreads the distinct-emoji cap over every carrier", () => {
    expectAccepted(
      documentOf(carriers(emojiSpread(MAX_EMOJI_PER_DOCUMENT, 0))),
    );
  });

  it.each(names.map((name, i) => [name, i] as const))(
    "one distinct emoji too many, the extra in %s, is refused",
    (_, i) => {
      expectRefused(
        documentOf(carriers(emojiSpread(MAX_EMOJI_PER_DOCUMENT + 1, i))),
      );
    },
  );

  it("refuses a button label past the per-run emoji cap", () => {
    const label = (count: number) =>
      ({
        ...plain("button"),
        label: Array(count).fill("\u{1F600}").join(" "),
      }) as DesignElement;
    expectAccepted(documentOf([label(MAX_EMOJI_PER_TEXT)]));
    expectRefused(documentOf([label(MAX_EMOJI_PER_TEXT + 1)]));
  });

  it("refuses a button label satori could loop on, as it does a text run", () => {
    const cluster = `a${"\u0301".repeat(MAX_MARKS_PER_CLUSTER + 1)}`;
    expectRefused(
      documentOf([{ ...plain("button"), label: cluster } as DesignElement]),
    );
    expectRefused(
      documentOf([
        { ...plain("text"), role: "body", text: cluster } as DesignElement,
      ]),
    );
  });

  const gradientFill = worst.elements.find(
    (element) =>
      element.type === "shape" && element.fill.startsWith("linear-gradient"),
  );
  const GRADIENT = gradientFill?.type === "shape" ? gradientFill.fill : "";

  /** Gradients on `onShapes` shapes and `onButtons` buttons. */
  function gradients(onShapes: number, onButtons: number): DesignElement[] {
    return [
      ...Array.from(
        { length: onShapes },
        (_, i) =>
          ({
            ...plain("shape", `shape-${i}`),
            fill: GRADIENT,
          }) as DesignElement,
      ),
      ...Array.from(
        { length: onButtons },
        (_, i) =>
          ({
            ...plain("button", `button-${i}`),
            fill: GRADIENT,
          }) as DesignElement,
      ),
    ];
  }

  it("counts gradients on buttons as well as shapes", () => {
    const cap = DOCUMENT_LIMITS.gradients;
    expect(GRADIENT).not.toBe("");
    const buttons = DOCUMENT_LIMITS.byType.button;
    expectAccepted(documentOf(gradients(cap - 1, 1)));
    /* One too many with as many as possible on buttons, then with the extra
       one on a button. */
    expectRefused(documentOf(gradients(cap + 1 - buttons, buttons)));
    expectRefused(documentOf(gradients(cap, 1)));
  });

  it("refuses a gradient spelled in a way satori draws as black", () => {
    for (const fill of [` ${GRADIENT}`, GRADIENT.toUpperCase()]) {
      expectRefused(documentOf([{ ...plain("shape"), fill } as DesignElement]));
    }
  });
});

describe("the worst case itself", () => {
  it("parses and comes back unchanged", () => {
    expectAccepted(worst);
  });
});
