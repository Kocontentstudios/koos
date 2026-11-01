import { describe, expect, it } from "vitest";
import { stopsMidPhrase } from "./phrase";

describe("stopsMidPhrase", () => {
  it("finds a point with its object cut out", () => {
    for (const text of [
      "Weekday bookings get a",
      "Weekday bookings get",
      "Every plan includes",
      "Tune-ups for",
      "Delivered to your",
      "Hand-dyed indigo adire, no",
    ]) {
      expect(stopsMidPhrase(text), text).toBe(true);
    }
  });

  it("reads whole points, names and grades as whole", () => {
    for (const text of [
      "Weekday bookings get a free scalp massage",
      "Closing our Series A",
      "Rated Grade A",
      "Open Tuesday to Saturday",
      "",
    ]) {
      expect(stopsMidPhrase(text), text).toBe(false);
    }
  });
});
