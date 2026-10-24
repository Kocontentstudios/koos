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
import { MAX_EMOJI_PER_DOCUMENT, MAX_EMOJI_PER_TEXT } from "./text-safety";

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

function expectAccepted(doc: DesignDocument) {
  const result = parses(doc);
  expect(result.error?.issues ?? []).toEqual([]);
  /* A transform that grows a value after the bound check passes the check
     and draws the grown value; the parsed document must be the input. */
  expect(result.data).toEqual(doc);
}

function expectRefused(doc: DesignDocument) {
  expect(parses(doc).success).toBe(false);
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

describe("the worst case itself", () => {
  it("parses and comes back unchanged", () => {
    expectAccepted(worst);
  });
});
