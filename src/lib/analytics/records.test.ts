import { describe, expect, it } from "vitest";
import { DEFAULT_SCOPE, loadAdminScope } from "@/lib/admin/scope-params";
import {
  isRecordKind,
  METRIC_FILTERS,
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

  /* The metric is the caller's second argument, named explicitly. A patch is
     for the OTHER keys — letting it override the metric would mean a By-type
     row could silently open a different card's records. */
  it("does not let a patch override the metric it was given", () => {
    const href = recordsHref(scope(), "tickets", {
      metric: "users",
    } as Partial<Parameters<typeof recordsHref>[0]>);
    expect(parse(href).metric).toBe("tickets");
  });

  it("points at the records route", () => {
    for (const kind of RECORD_KINDS) {
      expect(recordsHref(scope(), kind).split("?")[0]).toBe(
        "/admin/analytics/records",
      );
    }
  });
});

/* ── METRIC_FILTERS ────────────────────────────────────────────────────── */

/* The header renders two sentences from this table — "narrowed to X" and "Y
   does not apply" — and before it existed those two were derived
   independently, so a metric could be described as narrowed by a filter its
   query never applied. */
describe("METRIC_FILTERS covers the vocabulary exactly", () => {
  it("has an entry for every record kind and no others", () => {
    expect(Object.keys(METRIC_FILTERS).sort()).toEqual(
      [...RECORD_KINDS].sort(),
    );
  });

  /* A signup belongs to no brand, has no ticket status and is not a
     generation. Applying any of the three would zero the card whenever an
     operator filtered, and the zero would read as an answer. */
  it("marks new users as honouring none of the three", () => {
    expect(METRIC_FILTERS.users).toEqual({
      brand: false,
      status: false,
      kind: false,
    });
  });

  /* The activity-type filter is a usage_events column. Only the two metrics
     that read that table can honour it. */
  it("only lets usage-event metrics honour the activity type", () => {
    const honouring = RECORD_KINDS.filter((k) => METRIC_FILTERS[k].kind);
    expect([...honouring].sort()).toEqual(["brands", "generations"]);
  });

  /* Ticket status is a design_tickets column, and the approval RATE is
     deliberately excluded: its own status is the outcome being measured, so
     filtering on it would move numerator and denominator together. */
  it("only lets ticket metrics honour the ticket status", () => {
    const honouring = RECORD_KINDS.filter((k) => METRIC_FILTERS[k].status);
    expect([...honouring].sort()).toEqual(["approvals", "tickets"]);
  });

  it("keeps the approval rate blind to ticket status on purpose", () => {
    expect(METRIC_FILTERS.deliveries.status).toBe(false);
    expect(METRIC_FILTERS.deliveries.brand).toBe(true);
  });

  /* Every metric except new users reaches a brand somehow — through its own
     column, or a join. A metric silently dropping the brand filter shows an
     unnarrowed list under a header saying a brand was selected. */
  it("honours the brand filter everywhere a brand exists", () => {
    for (const kind of RECORD_KINDS) {
      expect(METRIC_FILTERS[kind].brand).toBe(kind !== "users");
    }
  });
});

describe("every record kind is nameable and describable", () => {
  it.each([...RECORD_KINDS])("%s has a label and a description", (kind) => {
    expect(RECORD_LABELS[kind]).toBeTruthy();
    expect(RECORD_DESCRIPTIONS[kind]).toBeTruthy();
  });

  /* Two metrics sharing a label makes the records header ambiguous about which
     number the operator clicked. */
  it("gives no two metrics the same label", () => {
    const labels = RECORD_KINDS.map((k) => RECORD_LABELS[k]);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
