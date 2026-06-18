import { describe, expect, it } from "vitest";
import { deliverablesZipName, formatTicketNumber } from "./ticket";

describe("formatTicketNumber", () => {
  it("zero-pads to 5 digits", () => {
    expect(formatTicketNumber(1)).toBe("DT-00001");
    expect(formatTicketNumber(124)).toBe("DT-00124");
  });
  it("does not truncate numbers beyond 5 digits", () => {
    expect(formatTicketNumber(123456)).toBe("DT-123456");
  });
});

describe("deliverablesZipName", () => {
  it("builds a zip filename from the ticket number", () => {
    expect(deliverablesZipName(124)).toBe("DT-00124-deliverables.zip");
  });
});
