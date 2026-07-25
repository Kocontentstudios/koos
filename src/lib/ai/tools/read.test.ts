import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: vi.fn(),
  getBrandById: vi.fn(),
  getAllBrandContexts: vi.fn(),
  getBrandAssets: vi.fn(),
  getStrategiesByBrand: vi.fn(),
  getActiveCalendarForBrand: vi.fn(),
  getCalendarItems: vi.fn(),
  listDesignTicketsForBrand: vi.fn(),
  getRecentConversationsForBrand: vi.fn(),
  getConversationMessages: vi.fn(),
}));

import * as q from "@/lib/db/queries";
import { buildReadTools } from "./read";

const ctx = { userId: "u1", brandId: "b1" };

describe("read tools", () => {
  it("returns an error object when access is denied (no data leak)", async () => {
    vi.mocked(q.checkBrandAccess).mockResolvedValue({ ok: false, status: 404, error: "Brand not found" });
    const tools = buildReadTools(ctx);
    const out = await tools.get_brand_profile.execute!({}, { toolCallId: "t", messages: [] });
    expect(out).toEqual({ error: "Brand not found" });
    expect(q.getBrandById).not.toHaveBeenCalled();
  });

  it("returns brand data when access is granted", async () => {
    vi.mocked(q.checkBrandAccess).mockResolvedValue({ ok: true, brand: { id: "b1", name: "Acme" } } as never);
    vi.mocked(q.getBrandById).mockResolvedValue({ id: "b1", name: "Acme", tone: "bold" } as never);
    vi.mocked(q.getAllBrandContexts).mockResolvedValue([]);
    const tools = buildReadTools(ctx);
    const out = await tools.get_brand_profile.execute!({}, { toolCallId: "t", messages: [] });
    expect(out).toMatchObject({ brand: { name: "Acme" } });
  });
});
