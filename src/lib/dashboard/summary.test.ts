import { describe, expect, it } from "vitest";
import { isOpenTicket, ticketCounts, upcomingItems } from "./summary";

describe("ticketCounts", () => {
  it("splits open vs delivered", () => {
    const counts = ticketCounts([
      { status: "submitted" },
      { status: "in_progress" },
      { status: "delivered" },
      { status: "revision_requested" },
    ]);
    expect(counts).toEqual({ open: 3, delivered: 1, total: 4 });
  });
  it("treats everything but delivered and draft as open", () => {
    expect(isOpenTicket("ready_for_review")).toBe(true);
    expect(isOpenTicket("delivered")).toBe(false);
    expect(isOpenTicket("draft")).toBe(false);
  });

  it("excludes drafts from all counts", () => {
    const counts = ticketCounts([
      { status: "draft" },
      { status: "submitted" },
      { status: "delivered" },
    ]);
    expect(counts).toEqual({ open: 1, delivered: 1, total: 2 });
  });
});

describe("upcomingItems", () => {
  const now = new Date("2026-06-17T12:00:00Z"); // Wed
  const mk = (iso: string, title: string) => ({ date: new Date(iso), title });
  const items = [
    mk("2026-06-16T00:00:00Z", "past"),
    mk("2026-06-17T00:00:00Z", "today"),
    mk("2026-06-20T00:00:00Z", "in-3d"),
    mk("2026-06-24T00:00:00Z", "in-7d-exclusive"), // == start+7d → excluded
    mk("2026-06-30T00:00:00Z", "far"),
  ];
  it("keeps items within [today, today+7d) sorted ascending", () => {
    expect(upcomingItems(items, now).map((i) => i.title)).toEqual([
      "today",
      "in-3d",
    ]);
  });
  it("honors a custom window", () => {
    // 14-day window from 06-17 reaches 07-01 (exclusive), so 06-30 is included.
    expect(upcomingItems(items, now, 14).map((i) => i.title)).toEqual([
      "today",
      "in-3d",
      "in-7d-exclusive",
      "far",
    ]);
  });
});
