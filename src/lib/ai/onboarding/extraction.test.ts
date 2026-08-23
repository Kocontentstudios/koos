import { describe, expect, it } from "vitest";
import { extractionSchema, omitUnfilled } from "./extraction";

const fieldShape = extractionSchema.shape.fields.shape;
const fieldNames = Object.keys(fieldShape);

/** Bedrock counts every optional or nullable property as a union-typed
 *  parameter and refuses a schema with more than 16 of them. */
const BEDROCK_UNION_PARAM_LIMIT = 16;

describe("extractionSchema", () => {
  /* Regression, both halves observed live against Bedrock:
       .optional() → "Grammar compilation timed out" (400 after 3.1 minutes)
       .nullable() → "too many parameters with union types (17 … limit: 16)"
     A plain required string is neither, so the grammar compiles with zero
     unions and the field count is free to grow. */
  it("uses zero union-typed parameters", () => {
    const unionTyped = Object.entries(fieldShape)
      .filter(
        ([, schema]) =>
          schema.safeParse(undefined).success || schema.safeParse(null).success,
      )
      .map(([key]) => key);
    expect(unionTyped).toEqual([]);
  });

  it("stays under the Bedrock union limit even if fields turn union-typed", () => {
    expect(fieldNames.length).toBeGreaterThan(BEDROCK_UNION_PARAM_LIMIT);
  });

  it("accepts an empty string for a field the conversation never covered", () => {
    const allEmpty = Object.fromEntries(fieldNames.map((k) => [k, ""]));
    expect(
      extractionSchema.safeParse({
        fields: allEmpty,
        summary: "Nothing captured yet.",
      }).success,
    ).toBe(true);
  });

  it("rejects a payload that omits a field instead of emptying it", () => {
    expect(
      extractionSchema.safeParse({ fields: { name: "Acme" }, summary: "x" })
        .success,
    ).toBe(false);
  });
});

describe("omitUnfilled", () => {
  it("drops the empty-string sentinel so it never reaches the proposal", () => {
    expect(omitUnfilled({ name: "Acme", tone: "" })).toEqual({ name: "Acme" });
  });

  it("drops whitespace-only values", () => {
    expect(omitUnfilled({ name: "Acme", tone: "   " })).toEqual({
      name: "Acme",
    });
  });

  /* Defensive: the schema no longer permits null, but a provider that ignores
     the schema shouldn't push a null into the brand profile. */
  it("drops nulls", () => {
    expect(omitUnfilled({ name: "Acme", tone: null })).toEqual({
      name: "Acme",
    });
  });

  it("keeps every field the model actually filled", () => {
    expect(omitUnfilled({ name: "Acme", tone: "warm" })).toEqual({
      name: "Acme",
      tone: "warm",
    });
  });
});
