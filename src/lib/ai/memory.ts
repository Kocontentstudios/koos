import { generateObject } from "ai";
import { z } from "zod";
import {
  getBrandMemory,
  type MemoryFact,
  upsertBrandMemory,
} from "@/lib/db/queries";
import { getModel } from "./provider";

const MAX_FACTS = 50;
const MAX_SUMMARY_LENGTH = 2000;

const memoryUpdateSchema = z.object({
  summary: z.string(),
  newFacts: z.array(z.string()),
});

export async function buildMemoryBlock(brandId: string): Promise<string> {
  try {
    const memory = await getBrandMemory(brandId);
    return memory?.summary ?? "";
  } catch (err) {
    // Best-effort: a memory-read failure must never break the chat turn.
    console.error("brand memory read failed", err);
    return "";
  }
}

export async function summarizeIntoMemory({
  brandId,
  userText,
  assistantText,
}: {
  brandId: string;
  userText: string;
  assistantText: string;
}): Promise<void> {
  try {
    const existing = await getBrandMemory(brandId);

    const { object } = await generateObject({
      model: getModel("chat"),
      schema: memoryUpdateSchema,
      // Small cap — this is a rolling summary, not the transcript.
      maxOutputTokens: 1500,
      system:
        "You maintain a compact, durable memory of a brand across chat conversations. " +
        "Given the prior memory summary and the latest turn, produce an updated summary " +
        "(a few sentences, no fluff) and any new durable facts worth remembering " +
        "(preferences, decisions, constraints — not one-off chit-chat).",
      prompt: `PRIOR MEMORY SUMMARY:
${existing?.summary || "(none yet)"}

LATEST TURN:
User: ${userText}
Assistant: ${assistantText}`,
    });

    const newFacts: MemoryFact[] = object.newFacts.map((text) => ({
      text,
      source: "chat",
      createdAt: new Date().toISOString(),
    }));
    const mergedFacts = [...(existing?.facts ?? []), ...newFacts].slice(
      -MAX_FACTS,
    );

    await upsertBrandMemory(brandId, {
      summary: object.summary.slice(0, MAX_SUMMARY_LENGTH),
      facts: mergedFacts,
    });
  } catch (err) {
    // Best-effort: memory updates must never break the chat turn.
    console.error("brand memory summarization failed", err);
  }
}
