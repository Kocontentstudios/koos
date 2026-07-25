import { tool, type Tool } from "ai";
import { z } from "zod";
import { type ToolContext, withBrandAccess } from "./context";
import { type Proposal, ProposalSchema } from "./proposals";

function ok(proposal: Proposal) {
  return { proposal: ProposalSchema.parse(proposal) };
}

export function buildProposeTools(ctx: ToolContext): Record<string, Tool> {
  return {
    propose_brand_field_updates: tool({
      description: "Draft updates to brand profile fields for the user to confirm. Does NOT save.",
      inputSchema: z.object({
        summary: z.string(),
        fields: z.record(z.string(), z.string()),
      }),
      execute: ({ summary, fields }) =>
        withBrandAccess(ctx, async () => ok({ kind: "brand_fields", summary, data: { fields } })),
    }),
    propose_design_ticket: tool({
      description: "Draft a design ticket for the user to confirm. Does NOT submit it.",
      inputSchema: z.object({
        summary: z.string(),
        designType: z.string(),
        brief: z.string(),
        dimensions: z.string().optional(),
        slides: z.number().int().positive().optional(),
        notes: z.string().optional(),
      }),
      execute: ({ summary, ...data }) =>
        withBrandAccess(ctx, async () => ok({ kind: "design_ticket", summary, data })),
    }),
    propose_calendar_generation: tool({
      description: "Draft a content-calendar generation request for the user to confirm.",
      inputSchema: z.object({
        summary: z.string(),
        strategyId: z.string().uuid().optional(),
        startDate: z.string(),
        endDate: z.string(),
        cadence: z.string().optional(),
      }),
      execute: ({ summary, ...data }) =>
        withBrandAccess(ctx, async () => ok({ kind: "calendar", summary, data })),
    }),
    propose_strategy: tool({
      description: "Draft a marketing-strategy generation request for the user to confirm.",
      inputSchema: z.object({ summary: z.string(), name: z.string(), seed: z.string() }),
      execute: ({ summary, name, seed }) =>
        withBrandAccess(ctx, async () => ok({ kind: "strategy", summary, data: { name, seed } })),
    }),
  };
}
