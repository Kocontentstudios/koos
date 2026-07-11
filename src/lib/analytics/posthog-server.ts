import { PostHog } from "posthog-node";

/**
 * Server-side PostHog capture. A silent no-op when NEXT_PUBLIC_POSTHOG_KEY is
 * unset (dev/staging without keys), and never throws — analytics must not
 * break a request.
 *
 * flushAt 1 / flushInterval 0 + captureImmediate suit serverless: each event
 * is sent before the invocation is frozen, no background queue to lose.
 */
let client: PostHog | null = null;

function getClient(): PostHog | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  if (!client) {
    client = new PostHog(key, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return client;
}

export interface ServerEvent {
  /** Stable user identifier — we use the DB user id. */
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}

export async function captureServerEvent(e: ServerEvent): Promise<void> {
  try {
    const ph = getClient();
    if (!ph) return;
    await ph.captureImmediate({
      distinctId: e.distinctId,
      event: e.event,
      properties: e.properties ?? {},
    });
  } catch (err) {
    console.error("posthog capture failed", err);
  }
}
