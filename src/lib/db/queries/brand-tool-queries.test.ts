import { describe, expect, it, vi } from "vitest";
import { getBrandAssets, listDesignTicketsForBrand } from "./index";

vi.mock("@/lib/db/client", () => ({ db: {} }));

describe("brand tool queries", () => {
  it("exports callable query functions", () => {
    expect(typeof getBrandAssets).toBe("function");
    expect(typeof listDesignTicketsForBrand).toBe("function");
  });
});
