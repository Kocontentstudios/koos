import { after } from "next/server";
import { z } from "zod";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import { getAuthUser } from "@/lib/auth/get-user";
import { setUserWelcomeSeenAt } from "@/lib/db/queries";

const bodySchema = z.object({
  action: z.enum(["start", "later"]),
});

/**
 * Marks the welcome card resolved — both CTAs count, since the gate is
 * "welcome_seen_at IS NULL". Starting onboarding and deferring it are equally
 * an answer, and a user who picked one should not be asked again.
 *
 * A malformed body still writes the timestamp, following the tour route: the
 * action is analytics detail, and losing it must never cost the user a working
 * dismissal.
 */
export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  const action = parsed.success ? parsed.data.action : "unknown";

  await setUserWelcomeSeenAt(dbUser.id, new Date());

  after(() =>
    captureServerEvent({
      distinctId: dbUser.id,
      event: "welcome_card_dismissed",
      properties: { action },
    }),
  );

  return Response.json({ ok: true });
}
