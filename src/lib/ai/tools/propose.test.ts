import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db/queries", () => ({ checkBrandAccess: vi.fn() }));
import * as q from "@/lib/db/queries";
import { buildProposeTools } from "./propose";
import { ProposalSchema } from "./proposals";

const ctx = { userId: "u1", brandId: "b1" };

describe("propose tools", () => {
  it("returns a valid, schema-conformant proposal (and writes nothing)", async () => {
    vi.mocked(q.checkBrandAccess).mockResolvedValue({ ok: true, brand: { id: "b1" } } as never);
    const tools = buildProposeTools(ctx);
    const out = await tools.propose_brand_field_updates.execute!(
      { fields: { tone: "playful" }, summary: "Set tone to playful" },
      { toolCallId: "t", messages: [] },
    );
    expect(ProposalSchema.safeParse((out as { proposal: unknown }).proposal).success).toBe(true);
  });

  it("returns an error object on access denial", async () => {
    vi.mocked(q.checkBrandAccess).mockResolvedValue({ ok: false, status: 403, error: "Denied" });
    const tools = buildProposeTools(ctx);
    const out = await tools.propose_design_ticket.execute!(
      { designType: "Logo", brief: "x", summary: "Logo" },
      { toolCallId: "t", messages: [] },
    );
    expect(out).toEqual({ error: "Denied" });
  });
});
