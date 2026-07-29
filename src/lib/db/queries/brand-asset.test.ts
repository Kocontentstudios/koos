import { describe, expect, it, vi } from "vitest";
import { addBrandAsset } from "./index";

vi.mock("@/lib/db/client", () => ({ db: {} }));

describe("addBrandAsset query", () => {
  it("exports a callable insert function", () => {
    expect(typeof addBrandAsset).toBe("function");
  });
});
