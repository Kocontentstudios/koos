import { describe, expect, it } from "vitest";
import { isPickDesign } from "../calendar/pick-mode";
import { VIEWS } from "../calendar/types";
import { START_REQUEST_OPTIONS } from "./start-request-options";

describe("START_REQUEST_OPTIONS", () => {
  it("offers the three start paths in order", () => {
    expect(START_REQUEST_OPTIONS.map((o) => o.key)).toEqual([
      "direct",
      "calendar",
      "campaign",
    ]);
  });

  /* Month view renders items as pointer-events-none chips and exposes no item
     click handler, so landing there would make the pick banner's instruction
     impossible to follow. Agenda is the only view wired to open the drawer. */
  it("lands the calendar option on a view whose items can be clicked", () => {
    const calendar = START_REQUEST_OPTIONS.find((o) => o.key === "calendar");
    const params = new URLSearchParams(calendar?.href.split("?")[1] ?? "");
    /* Routed through the calendar's own predicate so producer and consumer
       cannot drift: the link is only pick mode if isPickDesign agrees. */
    expect(isPickDesign(params.get("pick") ?? undefined)).toBe(true);
    /* Checked against the calendar's own view literals: renaming a view would
       otherwise leave this green and the link dead. */
    expect(VIEWS).toContain(params.get("view"));
    expect(params.get("view")).toBe("agenda");
  });
});
