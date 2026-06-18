"use server";

import { updateStrategy } from "@/lib/db/queries";

export async function markStrategyActive(
  strategyId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await updateStrategy(strategyId, { status: "active" });
    return { ok: true };
  } catch (err) {
    console.error("markStrategyActive failed", err);
    return { ok: false, error: "Could not update strategy" };
  }
}
