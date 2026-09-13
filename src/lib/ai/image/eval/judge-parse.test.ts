import { describe, expect, it } from "vitest";
import { parseJudgeJson } from "./judge-parse";

describe("parseJudgeJson", () => {
  it("reads bare JSON", () => {
    expect(parseJudgeJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("reads a fenced block", () => {
    expect(parseJudgeJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("reads JSON wrapped in commentary", () => {
    expect(
      parseJudgeJson('Looking at the image...\n{"a":1}\nHope that helps!'),
    ).toEqual({ a: 1 });
  });

  it("keeps nested objects intact", () => {
    expect(parseJudgeJson('prefix {"a":{"b":2}} suffix')).toEqual({
      a: { b: 2 },
    });
  });

  /* A judge that answered in prose must fail the case loudly rather than
     return a shape the scorer silently reads as all-false. */
  it("throws when there is no JSON at all", () => {
    expect(() => parseJudgeJson("I cannot read that image.")).toThrow(
      /no JSON/,
    );
  });

  it("throws rather than returning a half-object", () => {
    expect(() => parseJudgeJson('{"a":1')).toThrow(/no JSON/);
  });
});
