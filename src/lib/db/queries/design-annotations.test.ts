import { describe, expect, it, vi } from "vitest";
import { addAnnotation, getAnnotationsForTicket } from "./index";

vi.mock("@/lib/db/client", () => ({ db: {} }));

describe("design annotations queries", () => {
  it("exports callable query functions", () => {
    expect(typeof addAnnotation).toBe("function");
    expect(typeof getAnnotationsForTicket).toBe("function");
  });
});
