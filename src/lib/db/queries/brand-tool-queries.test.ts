import { describe, expect, it } from "vitest";
import { getBrandAssets, listDesignTicketsForBrand } from "./index";

describe("brand tool queries", () => {
  it("exports callable query functions", () => {
    expect(typeof getBrandAssets).toBe("function");
    expect(typeof listDesignTicketsForBrand).toBe("function");
  });
});
