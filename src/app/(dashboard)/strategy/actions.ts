"use server";

import { type Strategy, strategySchema } from "@/lib/ai/strategy-schema";
import { requireBrand } from "@/lib/auth/require-brand";
import { getStrategyById, updateStrategy } from "@/lib/db/queries";

export type LoadStrategyResult =
  | { ok: true; strategy: Strategy; name: string; status: string }
  | { ok: false; error: string };

/**
 * Load a previously-saved strategy so the user can review and refine it.
 * Authorizes that the strategy belongs to the caller's active brand, then
 * validates the stored `structured` JSON against the current schema.
 *
 * `requireBrand()` runs OUTSIDE the try/catch on purpose: it may `redirect()`,
 * which works by throwing NEXT_REDIRECT — catching that would break auth.
 */
export async function loadStrategy(
  strategyId: string,
): Promise<LoadStrategyResult> {
  const { brand } = await requireBrand();
  try {
    const row = await getStrategyById(strategyId);
    // Same generic message whether it's missing or belongs to another brand,
    // so we don't leak which strategy ids exist.
    if (!row || row.brandId !== brand.id) {
      return { ok: false, error: "Strategy not found." };
    }
    const parsed = strategySchema.safeParse(row.structured);
    if (!parsed.success) {
      return { ok: false, error: "This strategy could not be loaded." };
    }
    return {
      ok: true,
      strategy: parsed.data,
      name: row.name,
      status: row.status,
    };
  } catch (err) {
    console.error("loadStrategy failed", err);
    return { ok: false, error: "Could not load strategy." };
  }
}

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
