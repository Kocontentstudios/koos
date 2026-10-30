import { describe, expect, it } from "vitest";
import { frameRow } from "./fixtures";
import {
  editableFields,
  editProblem,
  editsFrom,
  frameCopyOf,
} from "./frame-editor";

const typed = (
  t: Partial<Record<"headline" | "subheadline" | "cta", string>>,
) => ({
  headline: "",
  subheadline: "",
  cta: "",
  ...t,
});

describe("editsFrom", () => {
  const known = { headline: "Old", subheadline: "Sub", cta: "Buy" };

  it("is null when nothing changed, so a submit can't silently re-roll", () => {
    expect(
      editsFrom(["headline", "subheadline"], known, typed(known)),
    ).toBeNull();
  });

  it("sends a changed line as typed, spaces and case included", () => {
    expect(
      editsFrom(
        ["headline", "subheadline"],
        known,
        typed({ ...known, headline: "  NEW  " }),
      ),
    ).toEqual({ headline: "  NEW  " });
  });

  it("sends a cleared subheadline as empty, which removes the line", () => {
    expect(
      editsFrom(
        ["headline", "subheadline"],
        known,
        typed({ ...known, subheadline: "" }),
      ),
    ).toEqual({ subheadline: "" });
  });

  it("adds a line the frame did not have", () => {
    const bare = { headline: "Old", subheadline: "", cta: "" };
    expect(
      editsFrom(
        ["headline", "subheadline", "cta"],
        bare,
        typed({ headline: "Old", cta: "Reserve" }),
      ),
    ).toEqual({ cta: "Reserve" });
  });

  it("never sends a field the frame does not offer", () => {
    expect(
      editsFrom(
        ["headline", "subheadline"],
        known,
        typed({ ...known, cta: "x" }),
      ),
    ).toBeNull();
  });
});

describe("editProblem", () => {
  const fields = ["headline", "subheadline", "cta"] as const;

  it("is null for copy that fits", () => {
    expect(
      editProblem([...fields], typed({ headline: "Book now", cta: "Go" })),
    ).toBeNull();
  });

  it("requires a headline, whitespace alone included", () => {
    for (const headline of ["", "   "]) {
      expect(editProblem([...fields], typed({ headline }))).toEqual({
        field: "headline",
        message: "A frame needs a headline.",
      });
    }
  });

  it("names the field over the renderer's limit", () => {
    expect(
      editProblem([...fields], typed({ headline: "x".repeat(71) })),
    ).toEqual({
      field: "headline",
      message: "Keep the headline to 70 characters.",
    });
    expect(
      editProblem(
        [...fields],
        typed({ headline: "ok", subheadline: "x".repeat(141) }),
      )?.field,
    ).toBe("subheadline");
    expect(
      editProblem([...fields], typed({ headline: "ok", cta: "x".repeat(33) })),
    ).toEqual({
      field: "cta",
      message: "Keep the button text to 32 characters.",
    });
  });

  it("ignores a field the frame does not offer", () => {
    expect(
      editProblem(
        ["headline", "subheadline"],
        typed({ headline: "ok", cta: "x".repeat(99) }),
      ),
    ).toBeNull();
  });
});

describe("frame copy", () => {
  it("reads every line the server sends", () => {
    expect(frameCopyOf(frameRow(0))).toEqual({
      headline: "Headline 1",
      subheadline: "Subheadline 1",
      cta: "",
    });
    expect(frameCopyOf(frameRow(4))).toEqual({
      headline: "Headline 5",
      subheadline: "Subheadline 5",
      cta: "Book a table",
    });
  });

  it("reads a line the frame does not have as empty", () => {
    expect(
      frameCopyOf({ ...frameRow(1), subheadline: null, headline: null }),
    ).toEqual({ headline: "", subheadline: "", cta: "" });
  });

  it("offers the button text on the CTA frame only", () => {
    const slot = (role: "hook" | "body" | "cta") => ({
      index: 0,
      role,
      title: "",
      generation: null,
    });
    expect(editableFields(slot("hook"))).toEqual(["headline", "subheadline"]);
    expect(editableFields(slot("body"))).toEqual(["headline", "subheadline"]);
    expect(editableFields(slot("cta"))).toEqual([
      "headline",
      "subheadline",
      "cta",
    ]);
  });
});
