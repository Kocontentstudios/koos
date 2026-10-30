import { describe, expect, it } from "vitest";
import { frameRow } from "./fixtures";
import { editableFields, editsFrom, frameCopyOf } from "./frame-editor";

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

  it("sends a cleared known line as empty, which removes it", () => {
    expect(
      editsFrom(
        ["headline", "subheadline"],
        known,
        typed({ ...known, subheadline: "" }),
      ),
    ).toEqual({ subheadline: "" });
  });

  /* The serializer does not send subheadline or CTA yet; an empty field for
     a line the client never saw means "keep it", not "delete it". */
  it("keeps a line the client was never sent when its field is left empty", () => {
    const partial = { headline: "Old", subheadline: null, cta: null };
    expect(
      editsFrom(
        ["headline", "subheadline", "cta"],
        partial,
        typed({ headline: "Old" }),
      ),
    ).toBeNull();
    expect(
      editsFrom(
        ["headline", "subheadline", "cta"],
        partial,
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

describe("frame copy", () => {
  it("reads the headline, and the other lines once the server sends them", () => {
    expect(frameCopyOf(frameRow(0))).toEqual({
      headline: "Headline 1",
      subheadline: null,
      cta: null,
    });
    expect(
      frameCopyOf({
        ...frameRow(4),
        subheadline: "Sat 12",
        cta: "Book",
      } as never),
    ).toEqual({ headline: "Headline 5", subheadline: "Sat 12", cta: "Book" });
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
