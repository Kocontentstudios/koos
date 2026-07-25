import { checkBrandAccess } from "@/lib/db/queries";

export type ToolContext = { userId: string; brandId: string };

// Extract (not a bare `extends`) so the check distributes over the ok/error
// union instead of testing the whole union against `{ ok: true }` at once.
type BrandAccessOk = Extract<Awaited<ReturnType<typeof checkBrandAccess>>, { ok: true }>;

/** Runs the authorization choke point; returns { error } on denial so tools
 *  surface a message to the model instead of throwing into the stream. */
export async function withBrandAccess<T>(
  ctx: ToolContext,
  fn: (brand: BrandAccessOk["brand"]) => Promise<T>,
): Promise<T | { error: string }> {
  const access = await checkBrandAccess(ctx.userId, ctx.brandId, "manage_content");
  if (!access.ok) return { error: access.error };
  return fn(access.brand);
}
