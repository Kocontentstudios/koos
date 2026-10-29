import { describe, expect, it } from "vitest";
import { calendarRuns, dayBoundKept, dayWithBound } from "./day-qualifier";

describe("calendarRuns", () => {
  it("reads the bound at a day, before or after it", () => {
    const bounds = (text: string) =>
      calendarRuns(text).map((r) => [...r.bounds].sort());
    expect(bounds("Available from Monday")).toEqual([["from"]]);
    expect(bounds("Starting this Monday")).toEqual([["from"]]);
    expect(bounds("Monday onwards")).toEqual([["from"]]);
    expect(bounds("Until Monday only.")).toEqual([["only", "until"]]);
    expect(bounds("Apply by 30 November")).toEqual([["by"]]);
    expect(bounds("Your Monday treat")).toEqual([[]]);
  });

  it("puts a bound with a word between on that word, not the day", () => {
    expect([...calendarRuns("pickup from 7am on Monday")[0].bounds]).toEqual(
      [],
    );
  });

  it("reads a date as one run, its weekday and month together", () => {
    const [run] = calendarRuns("Reopening Sat. 12 Dec, 9am");
    expect([...run.names].sort()).toEqual(["dec", "sat"]);
  });

  it("does not read 'may', 'sun' or 'sat' in lower case as a calendar word", () => {
    expect(calendarRuns("you may sit in the sun")).toEqual([]);
  });

  it("negates a day only within its own clause", () => {
    const negated = (text: string) => calendarRuns(text).map((r) => r.negated);
    expect(negated("Closed on Monday.")).toEqual([true]);
    expect(negated("Not available Monday.")).toEqual([true]);
    expect(negated("Isn't out until Monday")).toEqual([true]);
    expect(negated("No queues. Available from Monday")).toEqual([false]);
    expect(negated("Available Monday, not Tuesday")).toEqual([false, true]);
  });
});

describe("dayBoundKept", () => {
  it("needs the fact's bound at the same day", () => {
    expect(dayBoundKept("available from Monday", "From Monday, 7am")).toBe(
      true,
    );
    expect(dayBoundKept("available from Monday", "Monday pickup")).toBe(false);
    expect(dayBoundKept("available from Monday", "Until Monday only")).toBe(
      false,
    );
  });

  it("never counts a negated day for a plain fact, nor a plain day for a negated one", () => {
    expect(
      dayBoundKept("Saturday 5 December", "Closed Saturday 5 December"),
    ).toBe(false);
    expect(dayBoundKept("Closed on Sundays", "Open Sundays")).toBe(false);
    expect(dayBoundKept("Closed on Sundays", "Closed Sundays")).toBe(true);
  });

  it("leaves a day the copy never names to the fact's other needs", () => {
    expect(dayBoundKept("Saturday 5 December", "5/12")).toBe(true);
    expect(dayBoundKept("from Monday", "From 7am")).toBe(false);
  });
});

describe("dayWithBound", () => {
  it("takes in the brief's bound before a day", () => {
    const brief = "New strawberry mille-feuille, available from Monday.";
    const at = brief.indexOf("Monday");
    expect(brief.slice(dayWithBound(brief, at), at + 6)).toBe("from Monday");
    const plain = "Reopen on Saturday";
    expect(dayWithBound(plain, plain.indexOf("Saturday"))).toBe(
      plain.indexOf("Saturday"),
    );
  });
});
