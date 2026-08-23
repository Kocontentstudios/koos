import { after } from "next/server";
import { z } from "zod";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { getAuthUser } from "@/lib/auth/get-user";
import { setUserTourCompletedAt } from "@/lib/db/queries";

const bodySchema = z.object({
  reason: z.enum(["completed", "skipped", "closed", "escape", "outside"]),
  stepIndex: z.number().int().min(0).max(50),
});

/**
 * Marks the product tour resolved — finished or dismissed, both count. The
 * dashboard gate is "tour_completed_at IS NULL", so every exit path must reach
 * here or the tour re-nags on every load.
 *
 * A malformed body still writes the timestamp: the reason and step index are
 * analytics detail, and losing them must never cost the user a working
 * dismissal.
 */
export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  const reason = parsed.success ? parsed.data.reason : "unknown";
  const stepIndex = parsed.success ? parsed.data.stepIndex : null;

  await setUserTourCompletedAt(dbUser.id, new Date());

  after(() =>
    captureServerEvent({
      distinctId: dbUser.id,
      event:
        reason === "completed"
          ? "product_tour_completed"
          : "product_tour_dismissed",
      properties: { reason, step_index: stepIndex },
    }),
  );

  return Response.json({ ok: true });
}
