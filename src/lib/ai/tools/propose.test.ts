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

  it("returns an error object (not a thrown exception) when no fields survive validation", async () => {
    vi.mocked(q.checkBrandAccess).mockResolvedValue({ ok: true, brand: { id: "b1" } } as never);
    const tools = buildProposeTools(ctx);
    await expect(
      tools.propose_brand_field_updates.execute!(
        { fields: {}, summary: "No-op update" },
        { toolCallId: "t", messages: [] },
      ),
    ).resolves.toHaveProperty("error");
  });

  it("returns a valid, schema-conformant calendar proposal", async () => {
    vi.mocked(q.checkBrandAccess).mockResolvedValue({ ok: true, brand: { id: "b1" } } as never);
    const tools = buildProposeTools(ctx);
    const out = await tools.propose_calendar_generation.execute!(
      { startDate: "2026-08-01", endDate: "2026-08-31", summary: "August calendar" },
      { toolCallId: "t", messages: [] },
    );
    expect(ProposalSchema.safeParse((out as { proposal: unknown }).proposal).success).toBe(true);
  });

  it("returns a valid, schema-conformant strategy proposal", async () => {
    vi.mocked(q.checkBrandAccess).mockResolvedValue({ ok: true, brand: { id: "b1" } } as never);
    const tools = buildProposeTools(ctx);
    const out = await tools.propose_strategy.execute!(
      { name: "Q3 Growth", seed: "Focus on retention", summary: "Q3 strategy" },
      { toolCallId: "t", messages: [] },
    );
    expect(ProposalSchema.safeParse((out as { proposal: unknown }).proposal).success).toBe(true);
  });
});
