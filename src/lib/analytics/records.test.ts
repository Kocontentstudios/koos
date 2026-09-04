import { describe, expect, it } from "vitest";
import { DEFAULT_SCOPE, loadAdminScope } from "@/lib/admin/scope-params";
import {
  isRecordKind,
  RECORD_DESCRIPTIONS,
  RECORD_KINDS,
  RECORD_LABELS,
  recordsHref,
} from "./records";

const scope = (over = {}) => ({ ...DEFAULT_SCOPE, ...over });
const parse = (href: string) =>
  loadAdminScope(new URLSearchParams(href.split("?")[1] ?? ""));

describe("the record vocabulary is complete", () => {
  it.each([...RECORD_KINDS])("%s has a label and a description", (kind) => {
    expect(RECORD_LABELS[kind]).toBeTruthy();
    expect(RECORD_DESCRIPTIONS[kind]).toBeTruthy();
  });

  it("has no orphan labels", () => {
    expect(Object.keys(RECORD_LABELS).sort()).toEqual([...RECORD_KINDS].sort());
    expect(Object.keys(RECORD_DESCRIPTIONS).sort()).toEqual(
      [...RECORD_KINDS].sort(),
    );
  });

  it("gives each metric a distinct label", () => {
    const labels = Object.values(RECORD_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("rejects a metric the page cannot render", () => {
    for (const junk of ["", "nope", "GENERATIONS", "../etc"]) {
      expect(isRecordKind(junk)).toBe(false);
    }
    for (const kind of RECORD_KINDS) expect(isRecordKind(kind)).toBe(true);
  });
});

/* FEAT-007 states this as "make sure the selected Analytics filters remain
   applied". Making it a property of the builder is what stops it being a
   decision each of the twelve links has to remember. */
describe("a drill-down never drops the filter that produced it", () => {
  const filtered = scope({
    range: "30d",
    kind: ["design_generated"],
    brand: "3aac081f-cae5-446c-af3a-eaa2dfc3f916",
    status: ["delivered"],
  });

  it.each([...RECORD_KINDS])("%s carries the whole scope", (kind) => {
    const back = parse(recordsHref(filtered, kind));
    expect(back.range).toBe("30d");
    expect(back.kind).toEqual(["design_generated"]);
    expect(back.brand).toBe("3aac081f-cae5-446c-af3a-eaa2dfc3f916");
    expect(back.status).toEqual(["delivered"]);
    expect(back.metric).toBe(kind);
  });

  it("carries a custom range's bounds", () => {
    const back = parse(
      recordsHref(
        scope({ range: "custom", from: "2026-08-01", to: "2026-08-10" }),
        "generations",
      ),
    );
    expect(back.range).toBe("custom");
    expect(back.from).toBe("2026-08-01");
    expect(back.to).toBe("2026-08-10");
  });

  /* A By-type row narrows to its own kind ON TOP of the active filter, rather
     than replacing the filter or ignoring the row. */
  it("lets a row patch one key without losing the rest", () => {
    const back = parse(
      recordsHref(filtered, "generations", { kind: ["calendar_generated"] }),
    );
    expect(back.kind).toEqual(["calendar_generated"]);
    expect(back.range).toBe("30d");
    expect(back.brand).toBe("3aac081f-cae5-446c-af3a-eaa2dfc3f916");
  });

  /* A drill-down starts at the beginning of its own list, whatever page the
     analytics view happened to be on. */
  it("resets the page", () => {
    expect(parse(recordsHref(scope({ page: 7 }), "users")).page).toBe(1);
  });

  it("points at the records route", () => {
    for (const kind of RECORD_KINDS) {
      expect(recordsHref(scope(), kind).split("?")[0]).toBe(
        "/admin/analytics/records",
      );
    }
  });
});
