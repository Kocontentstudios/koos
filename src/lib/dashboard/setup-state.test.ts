import { describe, expect, it } from "vitest";
import { getSetupState } from "./setup-state";

describe("getSetupState", () => {
  it("points at strategy creation when no strategy exists", () => {
    const state = getSetupState({ hasStrategy: false, hasCalendar: false });
    expect(state.stage).toBe("needs-strategy");
    expect(state.nextCta.href).toBe("/strategy");
  });

  it("points at calendar generation when a strategy exists but no calendar", () => {
    const state = getSetupState({ hasStrategy: true, hasCalendar: false });
    expect(state.stage).toBe("needs-calendar");
    expect(state.nextCta.href).toBe("/strategy");
    expect(state.nextCta.label).toMatch(/calendar/i);
  });

  it("is complete once strategy and calendar both exist", () => {
    const state = getSetupState({ hasStrategy: true, hasCalendar: true });
    expect(state.stage).toBe("complete");
    expect(state.nextCta.href).toBe("/calendar");
  });

  it("treats a calendar without a strategy as still needing a strategy", () => {
    // Defensive: can't normally happen (calendars require a strategy FK).
    const state = getSetupState({ hasStrategy: false, hasCalendar: true });
    expect(state.stage).toBe("needs-strategy");
  });
});
