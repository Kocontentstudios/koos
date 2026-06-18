import { describe, expect, it } from "vitest";
import { formatTicketNumber } from "./ticket-number";

describe("formatTicketNumber", () => {
  it("zero-pads to 5 digits with a DT- prefix", () => {
    expect(formatTicketNumber(124)).toBe("DT-00124");
  });
  it("does not truncate numbers longer than 5 digits", () => {
    expect(formatTicketNumber(123456)).toBe("DT-123456");
  });
  it("handles 1 as DT-00001", () => {
    expect(formatTicketNumber(1)).toBe("DT-00001");
  });
});
